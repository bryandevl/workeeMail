import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosResponse, AxiosError } from 'axios';
import { EmailableResponse } from '../interfaces/validation.interface';

@Injectable()
export class EmailApiService {
  private readonly logger = new Logger(EmailApiService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.emailable.com/v1';
  private readonly maxRetries = 3; // Máximo 3 intentos
  private readonly retryDelay = 2000; // 2 segundos entre reintentos
  private readonly requestTimeout = 30000; // 30 segundos timeout

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('EMAILABLE_API_KEY') || '';
    
    if (!this.apiKey) {
      this.logger.warn('⚠️  EMAILABLE_API_KEY no está configurada');
    }
  }

  async validateEmail(email: string): Promise<EmailableResponse> {
    let attempt = 1;
    
    while (attempt <= this.maxRetries) {
      try {
        this.logger.log(`Validando email: ${email} (Intento ${attempt}/${this.maxRetries})`);
        
        // Si no hay API key, devolver respuesta mock
        if (!this.apiKey) {
          this.logger.warn('API Key no configurada, usando respuesta mock');
          return {
            email,
            state: 'unknown',
            reason: 'no_api_key',
            processed_at: new Date().toISOString(),
          };
        }
        
        const response: AxiosResponse<EmailableResponse> = await axios.get(
          `${this.baseUrl}/verify`,
          {
            params: {
              email,
              api_key: this.apiKey,
            },
            timeout: this.requestTimeout,
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'EmailValidator/1.0'
            },
            // ✅ Configurar axios para manejar todos los códigos de estado
            validateStatus: (status) => {
              return status >= 200 && status < 600; // Aceptar todos los códigos para manejarlos manualmente
            }
          }
        );

        // ✅ MANEJO ESPECÍFICO DE TODOS LOS CÓDIGOS DE ESTADO
        const status = response.status;
        
        if (status >= 200 && status < 300) {
          // ✅ RESPUESTA EXITOSA (200-299)
          if (response.data && response.data.email) {
            this.logger.log(`✅ Email ${email} validado exitosamente. Estado: ${response.data.state} (Intento ${attempt})`);
            return response.data;
          } else {
            // Respuesta vacía o malformada
            this.logger.warn(`⚠️ Respuesta exitosa pero vacía para ${email} (Intento ${attempt})`);
            if (attempt < this.maxRetries) {
              await this.sleep(this.retryDelay);
              attempt++;
              continue;
            } else {
              return this.createErrorResponse(email, 'empty_response_max_retries');
            }
          }
        } else {
          // ✅ MANEJO DE CÓDIGOS DE ERROR ESPECÍFICOS
          const shouldRetry = this.handleErrorStatus(status, email, attempt, response.data);
          
          if (shouldRetry && attempt < this.maxRetries) {
            const waitTime = this.getRetryDelay(status, response.headers);
            this.logger.log(`🔄 Reintentando en ${waitTime}ms...`);
            await this.sleep(waitTime);
            attempt++;
            continue;
          } else {
            // No reintentar o se agotaron los intentos
            return this.createErrorResponse(email, this.getErrorReason(status), response.data);
          }
        }

      } catch (error: any) {
        this.logger.error(`❌ Error de conexión para ${email} (Intento ${attempt}/${this.maxRetries}):`, error.message);
        
        // Manejar errores de red/timeout
        if (this.isNetworkError(error) && attempt < this.maxRetries) {
          await this.sleep(this.retryDelay);
          attempt++;
          continue;
        } else {
          return this.createErrorResponse(email, 'network_error_max_retries', { error: error.message });
        }
      }
    }

    // Esto no debería ejecutarse nunca, pero por seguridad
    return this.createErrorResponse(email, 'unexpected_error_exit');
  }

  // ✅ MANEJO ESPECÍFICO DE CÓDIGOS DE ERROR
  private handleErrorStatus(status: number, email: string, attempt: number, responseData?: any): boolean {
    switch (status) {
      case 249:
        this.logger.warn(`⏳ Request taking longer than normal (249) para ${email} (Intento ${attempt}/${this.maxRetries})`);
        return true; // Reintentar
        
      case 400:
        this.logger.error(`❌ Bad Request (400) para ${email}: Request is structured incorrectly`);
        return false; // No reintentar - error del cliente
        
      case 401:
        this.logger.error(`❌ Unauthorized (401) para ${email}: API key not sent`);
        return false; // No reintentar - problema de autenticación
        
      case 402:
        this.logger.error(`❌ Payment Required (402) para ${email}: Not enough credits`);
        return false; // No reintentar - problema de créditos
        
      case 403:
        this.logger.error(`❌ Forbidden (403) para ${email}: Invalid API key or authentication failed`);
        return false; // No reintentar - problema de autenticación
        
      case 404:
        this.logger.error(`❌ Not Found (404) para ${email}: Specified resource does not exist`);
        return false; // No reintentar - recurso no existe
        
      case 429:
        this.logger.warn(`⏳ Too Many Requests (429) para ${email} (Intento ${attempt}/${this.maxRetries}): Rate limit exceeded`);
        return true; // Reintentar con delay
        
      case 500:
        this.logger.warn(`🔧 Internal Server Error (500) para ${email} (Intento ${attempt}/${this.maxRetries}): Server error`);
        return true; // Reintentar - error del servidor
        
      case 503:
        this.logger.warn(`🔧 Service Unavailable (503) para ${email} (Intento ${attempt}/${this.maxRetries}): Temporarily offline for maintenance`);
        return true; // Reintentar - mantenimiento
        
      default:
        this.logger.error(`❌ Unknown status ${status} para ${email} (Intento ${attempt}/${this.maxRetries})`);
        return status >= 500; // Solo reintentar errores 5xx
    }
  }

  // ✅ OBTENER DELAY APROPIADO SEGÚN EL ERROR
  private getRetryDelay(status: number, headers: any): number {
    switch (status) {
      case 249:
        return 5000; // 5 segundos para requests que toman tiempo
        
      case 429:
        // Respetar Retry-After header si existe
        const retryAfter = headers['retry-after'] || headers['Retry-After'];
        if (retryAfter) {
          return parseInt(retryAfter.toString()) * 1000;
        }
        return 10000; // 10 segundos por defecto para rate limiting
        
      case 500:
      case 503:
        return 3000; // 3 segundos para errores del servidor
        
      default:
        return this.retryDelay; // 2 segundos por defecto
    }
  }

  // ✅ OBTENER RAZÓN DEL ERROR
  private getErrorReason(status: number): string {
    const reasons = {
      249: 'request_taking_longer_than_normal',
      400: 'bad_request_structure',
      401: 'unauthorized_no_api_key',
      402: 'payment_required_no_credits',
      403: 'forbidden_invalid_api_key',
      404: 'not_found_resource_missing',
      429: 'too_many_requests_rate_limit',
      500: 'internal_server_error',
      503: 'service_unavailable_maintenance'
    };
    
    return reasons[status as keyof typeof reasons] || `unknown_error_${status}`;
  }

  // ✅ CREAR RESPUESTA DE ERROR CONSISTENTE
  private createErrorResponse(email: string, reason: string, additionalData?: any): EmailableResponse {
    return {
      email,
      state: 'unknown',
      reason,
      processed_at: new Date().toISOString(),
      ...additionalData
    };
  }

  // ✅ DETECTAR ERRORES DE RED
  private isNetworkError(error: any): boolean {
    return error.code === 'ECONNABORTED' || 
           error.code === 'ETIMEDOUT' || 
           error.code === 'ENOTFOUND' || 
           error.code === 'ECONNRESET' ||
           error.message.includes('timeout') ||
           error.message.includes('network');
  }

  // ✅ MÉTODO PARA VALIDACIÓN EN LOTE CON MANEJO ROBUSTO
  async validateEmailBatch(emails: string[]): Promise<EmailableResponse[]> {
    const results: EmailableResponse[] = [];
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;
    
    this.logger.log(`📊 Iniciando validación en lote de ${emails.length} emails`);
    
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      
      try {
        this.logger.log(`📧 Procesando email ${i + 1}/${emails.length}: ${email}`);
        
        // Si hay muchos errores consecutivos, pausar más tiempo
        if (consecutiveErrors >= 3) {
          this.logger.warn(`⚠️ ${consecutiveErrors} errores consecutivos, pausando 10 segundos...`);
          await this.sleep(10000);
          consecutiveErrors = 0;
        }
        
        const result = await this.validateEmail(email);
        results.push(result);
        
        // Resetear contador si la respuesta es exitosa
        if (result.state !== 'unknown' || !result.reason?.includes('error')) {
          consecutiveErrors = 0;
        } else {
          consecutiveErrors++;
        }
        
        // Si hay demasiados errores consecutivos, abortar el lote
        if (consecutiveErrors >= maxConsecutiveErrors) {
          this.logger.error(`❌ Demasiados errores consecutivos (${maxConsecutiveErrors}), abortando lote`);
          
          // Agregar errores para los emails restantes
          for (let j = i + 1; j < emails.length; j++) {
            results.push(this.createErrorResponse(emails[j], 'batch_aborted_too_many_errors'));
          }
          break;
        }
        
        // Rate limiting adaptativo
        const delay = this.getAdaptiveDelay(result, consecutiveErrors);
        if (i < emails.length - 1) {
          await this.sleep(delay);
        }
        
      } catch (error) {
        consecutiveErrors++;
        this.logger.error(`❌ Error en lote para ${email}:`, error);
        results.push(this.createErrorResponse(email, 'batch_processing_error', { error: error.message }));
      }
    }
    
    this.logger.log(`✅ Lote completado: ${results.length} emails procesados`);
    return results;
  }

  // ✅ DELAY ADAPTATIVO SEGÚN LA RESPUESTA
  private getAdaptiveDelay(result: EmailableResponse, consecutiveErrors: number): number {
    let baseDelay = 300; // 300ms base
    
    // Aumentar delay si hay errores
    if (consecutiveErrors > 0) {
      baseDelay += consecutiveErrors * 500;
    }
    
    // Aumentar delay según el tipo de respuesta
    if (result.reason?.includes('429')) {
      baseDelay = 5000; // 5 segundos para rate limiting
    } else if (result.reason?.includes('249')) {
      baseDelay = 2000; // 2 segundos para requests lentos
    } else if (result.reason?.includes('5')) {
      baseDelay = 1000; // 1 segundo para errores del servidor
    }
    
    return Math.min(baseDelay, 10000); // Máximo 10 segundos
  }

  // ✅ VERIFICAR SALUD DEL API CON CÓDIGOS ESPECÍFICOS
  async checkApiHealth(): Promise<{
    isHealthy: boolean,
    responseTime: number,
    statusCode?: number,
    statusMessage?: string,
    error?: string,
    recommendations?: string[],
    timestamp: string
  }> {
    const startTime = Date.now();
    
    try {
      this.logger.log('🔍 Verificando salud del API externo...');
      
      const testEmail = 'health-check@example.com';
      const response = await axios.get(
        `${this.baseUrl}/verify`,
        {
          params: {
            email: testEmail,
            api_key: this.apiKey,
          },
          timeout: 10000,
          validateStatus: () => true // Aceptar todos los códigos
        }
      );
      
      const responseTime = Date.now() - startTime;
      const status = response.status;
      const isHealthy = status >= 200 && status < 300;
      
      const statusMessages = {
        200: 'API funcionando correctamente',
        249: 'API respondiendo lentamente',
        401: 'API Key no válida',
        402: 'Sin créditos suficientes',
        403: 'API Key inválida o bloqueada',
        429: 'Rate limit activo',
        500: 'Error interno del servidor',
        503: 'Servicio en mantenimiento'
      };
      
      const recommendations = this.getHealthRecommendations(status);
      
      this.logger.log(`${isHealthy ? '✅' : '⚠️'} Health check: ${status} en ${responseTime}ms`);
      
      return {
        isHealthy,
        responseTime,
        statusCode: status,
        statusMessage: statusMessages[status as keyof typeof statusMessages] || `Código desconocido: ${status}`,
        recommendations,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      
      this.logger.error(`❌ Health check falló en ${responseTime}ms:`, error.message);
      
      return {
        isHealthy: false,
        responseTime,
        error: error.message,
        recommendations: ['Verificar conexión a internet', 'Verificar configuración del API'],
        timestamp: new Date().toISOString()
      };
    }
  }

  // ✅ RECOMENDACIONES SEGÚN EL ESTADO DEL API
  private getHealthRecommendations(status: number): string[] {
    switch (status) {
      case 249:
        return ['El API está lento, considerar aumentar timeouts', 'Reducir frecuencia de requests'];
      case 401:
        return ['Verificar que EMAILABLE_API_KEY esté configurada', 'Verificar que la API key sea válida'];
      case 402:
        return ['Revisar créditos disponibles en la cuenta', 'Contactar soporte de Emailable'];
      case 403:
        return ['Verificar API key', 'Verificar parámetros de autenticación'];
      case 429:
        return ['Reducir frecuencia de requests', 'Implementar backoff exponencial'];
      case 500:
        return ['Esperar y reintentar más tarde', 'Contactar soporte si persiste'];
      case 503:
        return ['El servicio está en mantenimiento', 'Reintentar más tarde'];
      default:
        return status >= 200 && status < 300 ? ['API funcionando correctamente'] : ['Revisar documentación del API'];
    }
  }

  // ✅ ESTADÍSTICAS Y CONFIGURACIÓN
  getRetryConfiguration(): {
    maxRetries: number,
    retryDelay: number,
    requestTimeout: number,
    supportedErrorCodes: {[key: number]: string},
    retryableErrors: number[],
    nonRetryableErrors: number[]
  } {
    return {
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay,
      requestTimeout: this.requestTimeout,
      supportedErrorCodes: {
        249: 'Request taking longer than normal (retryable)',
        400: 'Bad Request (non-retryable)',
        401: 'Unauthorized (non-retryable)',
        402: 'Payment Required (non-retryable)',
        403: 'Forbidden (non-retryable)',
        404: 'Not Found (non-retryable)',
        429: 'Too Many Requests (retryable)',
        500: 'Internal Server Error (retryable)',
        503: 'Service Unavailable (retryable)'
      },
      retryableErrors: [249, 429, 500, 503],
      nonRetryableErrors: [400, 401, 402, 403, 404]
    };
  }

  // ✅ MÉTODOS DE UTILIDAD
  isEmailValid(response: EmailableResponse): boolean {
    return response.state === 'deliverable';
  }

  getStateDescription(state: string): string {
    const descriptions = {
      'deliverable': 'Email válido y entregable',
      'undeliverable': 'Email inválido o no existe',
      'risky': 'Email riesgoso (puede ser spam trap)',
      'unknown': 'No se pudo determinar el estado',
    };
    
    return descriptions[state as keyof typeof descriptions] || 'Estado desconocido';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}