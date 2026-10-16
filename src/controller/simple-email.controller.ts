import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  ParseIntPipe,
  HttpException,
  HttpStatus,
  Logger,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { SimpleEmailService } from '../services/simple-email.service';
import { ExcelService } from '../services/excel.service';

@Controller('simple-email')
export class SimpleEmailController {
  private readonly logger = new Logger(SimpleEmailController.name);

  constructor(
    private simpleEmailService: SimpleEmailService,
    private excelService: ExcelService,
  ) {}

  /**
 * Stream SSE de estado de trabajos en tiempo real
 * GET /simple-email/jobs-stream
 */
@Get('jobs-stream')
async jobsStream(@Res() reply: FastifyReply) {
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('Access-Control-Allow-Origin', '*');
  reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
  reply.raw.setHeader('X-Accel-Buffering', 'no');

  this.logger.log('📡 Cliente conectado al stream de trabajos');

  const interval = setInterval(() => {
    try {
      const jobsInfo = this.simpleEmailService.getJobsInfo();
      
      reply.raw.write(`data: ${JSON.stringify(jobsInfo)}\n\n`);
      
    } catch (error) {
      this.logger.error('Error enviando estado de trabajos:', error);
      clearInterval(interval);
      reply.raw.end();
    }
  }, 2000); // Actualiza cada 2 segundos

  reply.raw.on('close', () => {
    this.logger.log('🔌 Cliente desconectado del stream de trabajos');
    clearInterval(interval);
  });
}
  /**
   * Validación masiva - Inicia procesamiento
   * POST /simple-email/validate-masive
   */
  @Post('validate-masive')
  async validateBulkExcel(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    let uploadedFilePath: string | null = null;

    try {
      let fileBuffer: Buffer | null = null;
      let usuario: string | null = null;
      let campania: string | null = null;

      const parts = request.parts();
      
      for await (const part of parts) {
        if (part.type === 'file') {
          fileBuffer = await part.toBuffer();
          this.logger.log(`📁 Archivo recibido`);
        } else {
          const fieldName = part.fieldname;
          const fieldValue = part.value as string;
          
          if (fieldName === 'usuario') {
            usuario = fieldValue;
          } else if (fieldName === 'campania') {
            campania = fieldValue;
          }
        }
      }

      if (!fileBuffer) {
        throw new HttpException('No se recibió ningún archivo', HttpStatus.BAD_REQUEST);
      }

      if (!usuario || !campania) {
        throw new HttpException(
          'Usuario y campaña son campos requeridos',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`👤 Usuario: ${usuario} | 📋 Campaña: ${campania}`);

      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const filename = `emails-${Date.now()}.xlsx`;
      uploadedFilePath = path.join(uploadsDir, filename);
      
      await fs.promises.writeFile(uploadedFilePath, fileBuffer);
      this.logger.log(`📁 Archivo guardado: ${uploadedFilePath}`);

      const emailsData = await this.excelService.parseUploadedExcel(uploadedFilePath);

      if (emailsData.length === 0) {
        throw new HttpException(
          'El archivo no contiene datos válidos',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`📊 Emails extraídos: ${emailsData.length}`);

      const batchId = await this.simpleEmailService.createBatch(usuario, campania, emailsData.length);
      
      this.logger.log(`📝 Batch ID creado: ${batchId} - Iniciando procesamiento en background`);

      this.simpleEmailService.processEmailsInBackground(batchId, {
        usuario,
        campania,
        emails: emailsData,
      }).catch(error => {
        this.logger.error('Error en procesamiento background:', error);
      });

      reply.header('X-Batch-ID', batchId.toString());
      reply.header('Content-Type', 'application/json');
      reply.send({
        success: true,
        batchId: batchId,
        message: 'Procesamiento iniciado',
        total: emailsData.length
      });

      this.logger.log(`✅ Respuesta enviada - Procesamiento en curso para Batch ${batchId}`);

    } catch (error: any) {
      this.logger.error('❌ Error procesando Excel:', error.message);

      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        fs.unlinkSync(uploadedFilePath);
      }

      throw new HttpException(
        error.message || 'Error procesando archivo Excel',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Stream de progreso vía SSE
   * GET /simple-email/progress-stream/:batchId
   */
  @Get('progress-stream/:batchId')
  async progressStream(
    @Param('batchId') batchId: number,
    @Res() reply: FastifyReply,
  ) {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    this.logger.log(`📡 Cliente conectado al stream del batch ${batchId}`);

    const interval = setInterval(async () => {
      try {
        const progress = await this.simpleEmailService.getProgress(batchId);
        
        reply.raw.write(`data: ${JSON.stringify(progress)}\n\n`);
        
        this.logger.log(`📊 Progreso enviado: ${progress.progreso}%`);
        
        if (progress.completado) {
          this.logger.log(`✅ Stream completado para batch ${batchId}`);
          clearInterval(interval);
          reply.raw.end();
        }
      } catch (error) {
        this.logger.error('Error enviando progreso:', error);
        clearInterval(interval);
        reply.raw.end();
      }
    }, 1000);

    reply.raw.on('close', () => {
      this.logger.log(`🔌 Cliente desconectado del batch ${batchId}`);
      clearInterval(interval);
    });
  }

  /**
   * Descargar resultados (ZIP con Excel)
   * GET /simple-email/download/:batchId
   */
  @Get('download/:batchId')
  async downloadResults(
    @Param('batchId', ParseIntPipe) batchId: number,
    @Res() reply: FastifyReply,
  ) {
    try {
      this.logger.log(`📥 Solicitud de descarga para batch ${batchId}`);
      
      // ✅ Ahora lee desde archivo temporal
      const results = await this.simpleEmailService.getBatchResults(batchId);
      
      this.logger.log(`📊 Generando Excel con ${results.length} resultados`);
      
      const excelData = [
        ['DOCUMENTO', 'CORREO', 'ESTADO'],
        ...results.map((result) => [
          result.documento,
          result.correo,
          this.formatValidationStatus(result.estado),
        ]),
      ];

      const excelFilename = `resultados-${batchId}.xlsx`;
      const excelPath = await this.generateExcelFile(excelData, excelFilename);
      
      this.logger.log(`📄 Excel generado: ${excelPath}`);
      
      const zipBuffer = await this.createZipFromFile(excelPath, excelFilename);
      
      this.logger.log(`📦 ZIP creado: ${zipBuffer.length} bytes`);

      fs.unlink(excelPath, (err) => {
        if (err) this.logger.error('Error eliminando Excel temporal:', err);
      });

      const zipFilename = `resultados-${batchId}.zip`;
      
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${zipFilename}"`);
      reply.header('Access-Control-Allow-Origin', '*');
      reply.send(zipBuffer);
      
      this.logger.log(`✅ ZIP enviado correctamente para batch ${batchId}`);
    } catch (error: any) {
      this.logger.error(`❌ Error generando resultados para batch ${batchId}:`, error);
      this.logger.error(`Stack trace:`, error.stack);
      
      throw new HttpException(
        error.message || 'Error generando resultados',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ============================================
  // NUEVOS ENDPOINTS PARA GESTIÓN (OPCIONALES)
  // ============================================

  /**
   * Obtener estadísticas de archivos temporales
   * GET /simple-email/results-stats
   */
  @Get('results-stats')
  async getResultsStats() {
    try {
      const stats = await this.simpleEmailService.getResultsStats();
      
      return {
        success: true,
        data: stats,
        message: `${stats.totalFiles} archivo(s) en disco (${stats.totalSizeKB} KB)`
      };
    } catch (error: any) {
      this.logger.error('Error obteniendo estadísticas:', error);
      throw new HttpException(
        'Error obteniendo estadísticas de resultados',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Limpieza manual de todos los resultados
   * DELETE /simple-email/cleanup-results
   */
  @Delete('cleanup-results')
  async cleanupResults() {
    try {
      this.logger.log('🧹 Iniciando limpieza manual de resultados...');
      
      const result = await this.simpleEmailService.cleanupAllResults();
      
      return {
        success: true,
        data: result,
        message: `Limpieza completada: ${result.deleted} archivo(s) eliminado(s), ${result.freedKB.toFixed(2)} KB liberados`
      };
    } catch (error: any) {
      this.logger.error('Error en limpieza manual:', error);
      throw new HttpException(
        'Error al limpiar resultados',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Eliminar resultado específico
   * DELETE /simple-email/delete-result/:batchId
   */
  @Delete('delete-result/:batchId')
  async deleteSpecificResult(@Param('batchId', ParseIntPipe) batchId: number) {
    try {
      this.logger.log(`🗑️ Eliminando resultado del batch ${batchId}`);
      
      const deleted = await this.simpleEmailService.deleteResults(batchId);
      
      if (deleted) {
        return {
          success: true,
          message: `Resultado del batch ${batchId} eliminado correctamente`
        };
      } else {
        return {
          success: false,
          message: `No se encontró resultado para el batch ${batchId}`
        };
      }
    } catch (error: any) {
      this.logger.error(`Error eliminando batch ${batchId}:`, error);
      throw new HttpException(
        'Error al eliminar resultado',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ============================================
  // MÉTODOS PRIVADOS (sin cambios)
  // ============================================

  private async createZipFromFile(filePath: string, filename: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 6 } });
      const buffers: Buffer[] = [];

      archive.on('data', (chunk) => buffers.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(buffers)));
      archive.on('error', (err) => reject(err));

      archive.file(filePath, { name: filename });
      archive.finalize();
    });
  }

  private formatValidationStatus(status: string): string {
    const statusMap = {
      valid: 'VALIDO',
      invalid: 'INVALIDO',
      error: 'ERROR',
      true: 'VALIDO',
      false: 'INVALIDO',
      valido: 'VALIDO',
      invalido: 'INVALIDO',
      VALIDO: 'VALIDO',
      INVALIDO: 'INVALIDO',
      ERROR: 'ERROR',
    };
    return statusMap[status?.toLowerCase()] || 'DESCONOCIDO';
  }

  private async generateExcelFile(data: any[][], filename: string): Promise<string> {
    const XLSX = require('xlsx');

    try {
      const exportsDir = path.join(process.cwd(), 'exports');

      if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
      }

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(data);

      worksheet['!cols'] = [
        { width: 15 },
        { width: 35 },
        { width: 15 },
      ];

      if (worksheet['!ref']) {
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const address = XLSX.utils.encode_cell({ r: 0, c: C });
          if (worksheet[address]) {
            worksheet[address].s = {
              font: { bold: true },
              fill: { fgColor: { rgb: 'FFFFAA00' } },
            };
          }
        }
      }

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Resultados');

      const filePath = path.join(exportsDir, filename);
      XLSX.writeFile(workbook, filePath);

      return filePath;
    } catch (error: any) {
      this.logger.error('Error generando Excel:', error);
      throw new Error('Error al generar archivo Excel');
    }
  }
}