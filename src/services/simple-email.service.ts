import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import { Correo } from '../entities/correo.entity';
import { Resul_val_correo } from '../entities/result_val_correo.entity';
import { EmailApiService } from './email-api.service';

import { 
  BulkResult, 
  BulkValidationSummary, 
  EmailDataInput 
} from '../interfaces/validation.interface';

export interface BulkValidationInput {
  usuario: string;
  campania: string;
  emails: EmailDataInput[];
}

@Injectable()
export class SimpleEmailService {
  private readonly logger = new Logger(SimpleEmailService.name);

  // ✅ Directorio para resultados temporales
  private readonly RESULTS_DIR = path.join(process.cwd(), 'temp-results');

private readonly DIAS_REVALIDACION = {
  VALIDO: 180,
  INVALIDO: 90,
};

private readonly MESES_HISTORICO = 6;

// ✅ AGREGAR: Control de trabajos concurrentes
  private activeJobs: Map<number, {
    batchId: number;
    usuario: string;
    campania: string;
    total: number;
    startTime: Date;
    status: 'processing' | 'completed' | 'error';
  }> = new Map();
  
  private readonly MAX_CONCURRENT_JOBS = 6; 


  constructor(
    @InjectRepository(Correo)
    private correoRepository: Repository<Correo>,
    private emailApiService: EmailApiService,
    @InjectRepository(Resul_val_correo)
    private resulValidacionRepository: Repository<Resul_val_correo>,
  ) {
    // ✅ Crear directorio si no existe
    this.ensureResultsDirectoryExists();
    this.logger.log('✅ SimpleEmailService inicializado');
  }

  // ============================================
  // GESTIÓN DE ARCHIVOS TEMPORALES
  // ============================================

  /**
   * Asegurar que el directorio de resultados existe
   */
  private ensureResultsDirectoryExists(): void {
    if (!fs.existsSync(this.RESULTS_DIR)) {
      fs.mkdirSync(this.RESULTS_DIR, { recursive: true });
      this.logger.log(`📁 Directorio de resultados creado: ${this.RESULTS_DIR}`);
    }
  }
// ============================================
// CONTROL DE TRABAJOS CONCURRENTES
// ============================================

/**
 * Verificar si se puede iniciar un nuevo trabajo
 */
canStartNewJob(): boolean {
  const activeCount = Array.from(this.activeJobs.values())
    .filter(job => job.status === 'processing').length;
  
  return activeCount < this.MAX_CONCURRENT_JOBS;
}

/**
 * Obtener número de trabajos activos
 */
getActiveJobsCount(): number {
  return Array.from(this.activeJobs.values())
    .filter(job => job.status === 'processing').length;
}

/**
 * Obtener información de todos los trabajos
 */
getJobsInfo(): {
  active: number;
  maxConcurrent: number;
  available: number;
  jobs: Array<{
    batchId: number;
    usuario: string;
    campania: string;
    total: number;
    startTime: Date;
    status: string;
    duration?: number;
  }>;
} {
  const jobs = Array.from(this.activeJobs.values()).map(job => ({
    batchId: job.batchId,
    usuario: job.usuario,
    campania: job.campania,
    total: job.total,
    startTime: job.startTime,
    status: job.status,
    duration: job.status === 'processing' 
      ? Math.round((Date.now() - job.startTime.getTime()) / 1000) 
      : undefined,
  }));

  const activeCount = jobs.filter(j => j.status === 'processing').length;

  return {
    active: activeCount,
    maxConcurrent: this.MAX_CONCURRENT_JOBS,
    available: this.MAX_CONCURRENT_JOBS - activeCount,
    jobs: jobs.sort((a, b) => b.startTime.getTime() - a.startTime.getTime()),
  };
}

/**
 * Registrar inicio de trabajo
 */
private registerJob(batchId: number, usuario: string, campania: string, total: number): void {
  this.activeJobs.set(batchId, {
    batchId,
    usuario,
    campania,
    total,
    startTime: new Date(),
    status: 'processing',
  });
  
  this.logger.log(`📝 Trabajo registrado: Batch ${batchId} (${this.getActiveJobsCount()}/${this.MAX_CONCURRENT_JOBS} activos)`);
}

/**
 * Marcar trabajo como completado
 */
private completeJob(batchId: number, status: 'completed' | 'error' = 'completed'): void {
  const job = this.activeJobs.get(batchId);
  
  if (job) {
    job.status = status;
    const duration = Math.round((Date.now() - job.startTime.getTime()) / 1000);
    
    this.logger.log(`✅ Trabajo ${status}: Batch ${batchId} (${duration}s) - Quedan ${this.getActiveJobsCount() - 1}/${this.MAX_CONCURRENT_JOBS} activos`);
    
    // Eliminar trabajos completados después de 5 minutos
    setTimeout(() => {
      this.activeJobs.delete(batchId);
    }, 5 * 60 * 1000);
  }
}









  /**
   * CRON: Limpieza automática todos los días a las 11:59 PM
   * Elimina todos los archivos de resultados al final del día
   */
  @Cron('59 23 * * *', {
    name: 'cleanupDailyResults',
    timeZone: 'America/Lima', // ✅ Ajusta según tu zona horaria
  })
  async cleanupDailyResults(): Promise<void> {
    this.logger.log('🧹 ===== LIMPIEZA AUTOMÁTICA DIARIA INICIADA =====');
    
    try {
      const files = await fs.promises.readdir(this.RESULTS_DIR);
      let deletedCount = 0;
      let totalSizeKB = 0;
      
      for (const file of files) {
        if (file.startsWith('batch-') && file.endsWith('.json')) {
          const filePath = path.join(this.RESULTS_DIR, file);
          
          try {
            const stats = await fs.promises.stat(filePath);
            totalSizeKB += stats.size / 1024;
            
            await fs.promises.unlink(filePath);
            deletedCount++;
            this.logger.log(`🗑️ Eliminado: ${file}`);
          } catch (error) {
            this.logger.error(`❌ Error eliminando ${file}:`, error);
          }
        }
      }
      
      this.logger.log(`✅ Limpieza completada: ${deletedCount} archivo(s) eliminado(s) (${totalSizeKB.toFixed(2)} KB liberados)`);
    } catch (error) {
      this.logger.error('❌ Error en limpieza automática:', error);
    }
  }

  /**
   * Limpieza manual (llamar desde endpoint si es necesario)
   */
  async cleanupAllResults(): Promise<{ deleted: number; errors: number; freedKB: number }> {
    this.logger.log('🧹 Limpieza manual de todos los resultados...');
    
    let deleted = 0;
    let errors = 0;
    let freedKB = 0;
    
    try {
      const files = await fs.promises.readdir(this.RESULTS_DIR);
      
      for (const file of files) {
        if (file.startsWith('batch-') && file.endsWith('.json')) {
          const filePath = path.join(this.RESULTS_DIR, file);
          
          try {
            const stats = await fs.promises.stat(filePath);
            freedKB += stats.size / 1024;
            
            await fs.promises.unlink(filePath);
            deleted++;
          } catch (error) {
            errors++;
            this.logger.error(`Error eliminando ${file}:`, error);
          }
        }
      }
      
      this.logger.log(`✅ Limpieza manual completada: ${deleted} eliminados, ${errors} errores, ${freedKB.toFixed(2)} KB liberados`);
    } catch (error) {
      this.logger.error('❌ Error en limpieza manual:', error);
    }
    
    return { deleted, errors, freedKB };
  }

  /**
   * Guardar resultados en archivo temporal
   */
  private async saveResultsToFile(batchId: number, results: BulkResult[]): Promise<void> {
    this.ensureResultsDirectoryExists();
    
    const filePath = path.join(this.RESULTS_DIR, `batch-${batchId}.json`);
    
    try {
      await fs.promises.writeFile(
        filePath, 
        JSON.stringify(results, null, 2),
        'utf8'
      );
      
      const fileSizeKB = (JSON.stringify(results).length / 1024).toFixed(2);
      this.logger.log(`💾 Resultados guardados: batch-${batchId}.json (${results.length} registros, ${fileSizeKB} KB)`);
    } catch (error) {
      this.logger.error(`❌ Error guardando resultados en archivo:`, error);
      throw error;
    }
  }

  /**
   * Leer resultados desde archivo
   */
  async getBatchResults(batchId: number): Promise<BulkResult[]> {
    const filePath = path.join(this.RESULTS_DIR, `batch-${batchId}.json`);
    
    this.logger.log(`📥 Buscando resultados: batch-${batchId}.json`);
    
    try {
      if (!fs.existsSync(filePath)) {
        this.logger.error(`❌ Archivo no encontrado: batch-${batchId}.json`);
        throw new Error(
          `No se encontraron resultados para el batch ${batchId}. ` +
          `El archivo puede haber sido eliminado en la limpieza automática.`
        );
      }
      
      const data = await fs.promises.readFile(filePath, 'utf8');
      const results = JSON.parse(data);
      
      this.logger.log(`✅ Resultados cargados: ${results.length} registros`);
      return results;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Resultados del batch ${batchId} no disponibles`);
      }
      
      this.logger.error(`❌ Error leyendo batch ${batchId}:`, error);
      throw new Error(`Error al cargar resultados del batch ${batchId}`);
    }
  }

  /**
   * Eliminar resultados específicos
   */
  async deleteResults(batchId: number): Promise<boolean> {
    const filePath = path.join(this.RESULTS_DIR, `batch-${batchId}.json`);
    
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        this.logger.log(`🗑️ Resultados eliminados: batch-${batchId}.json`);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Error eliminando batch ${batchId}:`, error);
      return false;
    }
  }

  /**
   * Obtener estadísticas de archivos
   */
  async getResultsStats(): Promise<{
  totalFiles: number;
  totalSizeKB: number;
  oldestFile: string | null;
  newestFile: string | null;
}> {
  try {
    const files = await fs.promises.readdir(this.RESULTS_DIR);
    const batchFiles = files.filter(f => f.startsWith('batch-') && f.endsWith('.json'));
    
    let totalSizeKB = 0;
    let oldestTime = Date.now();
    let newestTime = 0;
    let oldestFile: string | null = null;  // ✅ AGREGAR TIPO EXPLÍCITO
    let newestFile: string | null = null;  // ✅ AGREGAR TIPO EXPLÍCITO
    
    for (const file of batchFiles) {
      const filePath = path.join(this.RESULTS_DIR, file);
      const stats = await fs.promises.stat(filePath);
      
      totalSizeKB += stats.size / 1024;
      
      if (stats.mtimeMs < oldestTime) {
        oldestTime = stats.mtimeMs;
        oldestFile = file; // ✅ Ahora puede aceptar string
      }
      
      if (stats.mtimeMs > newestTime) {
        newestTime = stats.mtimeMs;
        newestFile = file; // ✅ Ahora puede aceptar string
      }
    }
    
    return {
      totalFiles: batchFiles.length,
      totalSizeKB: Math.round(totalSizeKB),
      oldestFile,
      newestFile,
    };
  } catch (error) {
    this.logger.error('Error obteniendo estadísticas:', error);
    return {
      totalFiles: 0,
      totalSizeKB: 0,
      oldestFile: null,
      newestFile: null,
    };
  }
}

  // ============================================
  // MÉTODOS DE VALIDACIÓN
  // ============================================

  /**
   * Crear batch y devolver ID inmediatamente
   */
  async createBatch(usuario: string, campania: string, totalEmails: number): Promise<number> {
    const resulValidacion = this.resulValidacionRepository.create({
      usuario,
      campania,
      vali_total: totalEmails.toString(),
      vali_interno: '0',
      vali_api: '0',
      correos_validos: '0',
      correos_invalidos: '0',
      progreso: 0,
    });
    
    const saved = await this.resulValidacionRepository.save(resulValidacion);
    this.logger.log(`📝 Batch ${saved.id} creado - Total: ${totalEmails}`);
    
    return saved.id;
  }

  /**
   * Procesar emails en background
   */
  async processEmailsInBackground(batchId: number, bulkInput: BulkValidationInput): Promise<void> {
  const { usuario, campania, emails } = bulkInput;
  const totalEmails = emails.length;
  
  // ✅ REGISTRAR INICIO DEL TRABAJO
  this.registerJob(batchId, usuario, campania, totalEmails);
  
  this.logger.log(`🔄 Iniciando procesamiento background para Batch ${batchId}`);
  
  try {

    
    const results: BulkResult[] = [];
    let foundExisting = 0;
    let needsRevalidation = 0;
    let newRecordsCreated = 0;
    let errors = 0;
    let validEmailsCount = 0;
    let invalidEmailsCount = 0;

    // Procesar cada email
    for (let i = 0; i < totalEmails; i++) {
      const emailData = emails[i];
      
      try {
        const { documento, correo } = emailData;
const cleanEmail = this.cleanEmail(correo);
const normalizedDoc = this.normalizeDocumento(documento);
        // Validaciones básicas
        if (!this.isValidDocumento(documento) || !this.isValidEmailFormat(correo)) {
          errors++;
          invalidEmailsCount++;
          
          results.push({
            documento,
            correo,
            validado: false,
            estado: 'ERROR',
            fuente: 'ERROR'
          });
        } else {

  // ✅ BUSCAR SOLO POR CORREO
  const existingRecord = await this.correoRepository.findOne({
    where: { correo: cleanEmail },
  });

         if (existingRecord) {
    const fechaResult = this.getUltimaFechaValidacionConNull(existingRecord);

    // ✅ Sin fecha → revalidar por API
    // ✅ Fecha fuera del rango de 6 meses → tratar como nuevo (revalidar)
    const fueraDeRango =
      !fechaResult.tieneNulls && !this.estaEnRangoHistorico(fechaResult.fecha!);

    if (fechaResult.tieneNulls || fueraDeRango) {
      needsRevalidation++;
      const apiResponse = await this.emailApiService.validateEmail(correo);
      const isValid = apiResponse.state === 'deliverable';

      existingRecord.documento = normalizedDoc;   // actualizar doc por si cambió
      existingRecord.validado = isValid;
      existingRecord.updated_at = new Date();
      if (!existingRecord.created_at) existingRecord.created_at = new Date();
      await this.correoRepository.save(existingRecord);

      if (isValid) validEmailsCount++; else invalidEmailsCount++;
      results.push({ documento, correo, validado: isValid,
        estado: isValid ? 'VALIDO' : 'INVALIDO', fuente: 'API' });

      await this.sleep(100);

    } else {
      // ✅ Dentro del rango → evaluar si necesita revalidación por días
      const diasDesdeValidacion = this.calcularDiasDesde(fechaResult.fecha!);

      // CAMBIO: ya no se pasa esCampaniaCastigo
      const revalidar = this.necesitaRevalidacion(
        existingRecord.validado,
        diasDesdeValidacion,
      );

      if (revalidar) {
        needsRevalidation++;
        const apiResponse = await this.emailApiService.validateEmail(correo);
        const isValid = apiResponse.state === 'deliverable';

        existingRecord.validado = isValid;
        existingRecord.updated_at = new Date();
        await this.correoRepository.save(existingRecord);

        if (isValid) validEmailsCount++; else invalidEmailsCount++;
        results.push({ documento, correo, validado: isValid,
          estado: isValid ? 'VALIDO' : 'INVALIDO', fuente: 'API' });

        await this.sleep(100);

      } else {
        // ✅ Usar dato existente de BD
        foundExisting++;
        if (existingRecord.validado) validEmailsCount++; else invalidEmailsCount++;
        results.push({ documento, correo, validado: existingRecord.validado,
          estado: existingRecord.validado ? 'VALIDO' : 'INVALIDO', fuente: 'BD' });
      }
    }

  } else {
    // ✅ Correo nuevo → validar por API y crear registro
    newRecordsCreated++;
    const apiResponse = await this.emailApiService.validateEmail(correo);
    const isValid = apiResponse.state === 'deliverable';

    const newRecord = this.correoRepository.create({
      documento: normalizedDoc,
      correo: cleanEmail,
      validado: isValid,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await this.correoRepository.save(newRecord);

    if (isValid) validEmailsCount++; else invalidEmailsCount++;
    results.push({ documento, correo, validado: isValid,
      estado: isValid ? 'VALIDO' : 'INVALIDO', fuente: 'API' });

    await this.sleep(100);
  }
}
      } catch (error: any) {
        errors++;
        invalidEmailsCount++;
        this.logger.error(`❌ Error procesando email ${i + 1}:`, error.message);
        
        results.push({
          documento: emailData.documento,
          correo: emailData.correo,
          validado: false,
          estado: 'ERROR',
          fuente: 'ERROR'
        });
      }

      // Actualizar progreso después de cada email
      await this.actualizarProgreso(
        batchId, 
        totalEmails, 
        validEmailsCount, 
        invalidEmailsCount, 
        foundExisting, 
        needsRevalidation, 
        newRecordsCreated
      );
    }

    // Guardar resultados en archivo
    await this.saveResultsToFile(batchId, results);
    
    // ✅ MARCAR TRABAJO COMO COMPLETADO
    this.completeJob(batchId, 'completed');
    
    this.logger.log(`✅ Procesamiento completado - Batch ${batchId}: ${validEmailsCount} válidos, ${invalidEmailsCount} inválidos`);
    
  } catch (error: any) {
    // ✅ MARCAR TRABAJO COMO ERROR
    this.completeJob(batchId, 'error');
    
    this.logger.error(`❌ Error fatal en procesamiento del batch ${batchId}:`, error);
    
    // Intentar guardar lo que se procesó hasta el momento
    try {
      this.logger.log(`⚠️ Intentando guardar resultados parciales para batch ${batchId}`);
      // Aquí podrías guardar resultados parciales si lo deseas
    } catch (saveError) {
      this.logger.error(`❌ No se pudieron guardar resultados parciales:`, saveError);
    }
    
    throw error;
  }
}

  /**
   * Actualizar progreso en BD
   */
  private async actualizarProgreso(
    batchId: number,
    total: number,
    validEmailsCount: number,
    invalidEmailsCount: number,
    foundExisting: number,
    needsRevalidation: number,
    newRecordsCreated: number
  ): Promise<void> {
    const procesados = validEmailsCount + invalidEmailsCount;
    const totalApiCalls = needsRevalidation + newRecordsCreated;
    
    await this.resulValidacionRepository.update(batchId, {
      progreso: procesados,
      vali_interno: foundExisting.toString(),
      vali_api: totalApiCalls.toString(),
      correos_validos: validEmailsCount.toString(),
      correos_invalidos: invalidEmailsCount.toString(),
    });

    this.logger.log(`📊 Progreso: ${procesados}/${total} - Válidos: ${validEmailsCount} | Inválidos: ${invalidEmailsCount}`);
  }

  /**
   * Obtener progreso de un batch
   */
  async getProgress(batchId: number): Promise<{
    progreso: number;
    total: number;
    procesados: number;
    validos: number;
    invalidos: number;
    encontradosBD: number;
    validadosAPI: number;
    completado: boolean;
  }> {
    try {
      const batch = await this.resulValidacionRepository.findOne({
        where: { id: batchId }
      });

      if (!batch) {
        return {
          progreso: 0,
          total: 0,
          procesados: 0,
          validos: 0,
          invalidos: 0,
          encontradosBD: 0,
          validadosAPI: 0,
          completado: false
        };
      }

      const total = parseInt(batch.vali_total);
      const procesados = batch.progreso;
      const validos = parseInt(batch.correos_validos);
      const invalidos = parseInt(batch.correos_invalidos);
      
      const porcentaje = total > 0 ? Math.round((procesados / total) * 100) : 0;

      return {
        progreso: porcentaje,
        total,
        procesados,
        validos,
        invalidos,
        encontradosBD: parseInt(batch.vali_interno),
        validadosAPI: parseInt(batch.vali_api),
        completado: procesados >= total
      };
    } catch (error) {
      this.logger.error('Error obteniendo progreso:', error);
      throw error;
    }
  }

  /**
   * Obtener historial de validaciones
   */
  async getValidationHistory(usuario?: string, campania?: string): Promise<Resul_val_correo[]> {
    try {
      const whereClause: any = {};
      if (usuario) whereClause.usuario = usuario;
      if (campania) whereClause.campania = campania;
      
      return await this.resulValidacionRepository.find({
        where: whereClause,
        order: { fecha_registra: 'DESC' }
      });
    } catch (error) {
      this.logger.error('Error obteniendo historial:', error);
      return [];
    }
  }

  // ============================================
  // MÉTODOS AUXILIARES
  // ============================================



  private getUltimaFechaValidacionConNull(record: Correo): {
    fecha: Date | null;
    origen: 'updated_at' | 'created_at' | 'ninguna';
    tieneNulls: boolean;
  } {
    if (record.updated_at) {
      const fecha = typeof record.updated_at === 'string' 
        ? new Date(record.updated_at) 
        : record.updated_at;
        
      return {
        fecha: fecha,
        origen: 'updated_at',
        tieneNulls: false
      };
    }

    if (record.created_at) {
      const fecha = typeof record.created_at === 'string' 
        ? new Date(record.created_at) 
        : record.created_at;
        
      return {
        fecha: fecha,
        origen: 'created_at',
        tieneNulls: false
      };
    }

    return {
      fecha: null,
      origen: 'ninguna',
      tieneNulls: true
    };
  }

  private calcularDiasDesde(fecha: Date): number {
    const ahora = new Date();
    const diferencia = ahora.getTime() - fecha.getTime();
    return Math.floor(diferencia / (1000 * 60 * 60 * 24));
  }

private necesitaRevalidacion(
  esValido: boolean,
  diasDesdeValidacion: number,
): boolean {
  const diasLimite = esValido
    ? this.DIAS_REVALIDACION.VALIDO
    : this.DIAS_REVALIDACION.INVALIDO;

  return diasDesdeValidacion >= diasLimite;
}

// 4. NUEVO: verificar si la fecha cae dentro del rango de 6 meses
private estaEnRangoHistorico(fecha: Date): boolean {
  const limite = new Date();
  limite.setMonth(limite.getMonth() - this.MESES_HISTORICO);
  return fecha >= limite;
}

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isValidEmailFormat(email: string): boolean {
    if (!email) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private isValidDocumento(documento: string): boolean {
    if (!documento) return false;
    return documento.trim().length > 0;
  }

  private cleanEmail(email: string): string {
    if (!email) return '';
    return email.toLowerCase().trim();
  }

  private normalizeDocumento(documento: string): string {
    if (!documento) return '';
    
    let normalized = documento.trim().toUpperCase();
    
    if (/^\d{7}$/.test(normalized)) {
      normalized = '0' + normalized;
    }
    
    return normalized;
  }
}