// src/modules/email-validation/services/excel.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import { ValidationResultDto } from '../dto/validation-result.dto';

@Injectable()
export class ExcelService {
  private readonly logger = new Logger(ExcelService.name);
  private readonly exportsDir = path.join(process.cwd(), 'exports');

  constructor() {
    // Crear directorio de exports si no existe
    if (!fs.existsSync(this.exportsDir)) {
      fs.mkdirSync(this.exportsDir, { recursive: true });
    }
  }

  async parseUploadedExcel(filePath: string): Promise<any[]> {
    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      
      if (!sheetName) {
        throw new Error('El archivo Excel no contiene hojas válidas');
      }
      
      const worksheet = workbook.Sheets[sheetName];
      
      if (!worksheet) {
        throw new Error('No se pudo leer la hoja del Excel');
      }
      
      // Convertir a JSON
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      if (!data || data.length === 0) {
        throw new Error('El archivo Excel está vacío');
      }
      
      // Saltar la primera fila si es header
      const rows = data.slice(1);
      
      // Mapear a formato esperado
      return rows.map((row: any[]) => ({
        documento: row[0]?.toString().trim() || '',
        correo: row[1]?.toString().trim().toLowerCase() || '',
      })).filter(item => item.documento && item.correo);

    } catch (error: any) {
      this.logger.error('Error parseando Excel:', error);
      throw new Error(`Error al procesar archivo Excel: ${error.message}`);
    }
  }

  async generateResultsExcel(batchId: string, results: ValidationResultDto[]): Promise<string> {
    try {
      if (!results || results.length === 0) {
        throw new Error('No hay resultados para generar el Excel');
      }

      // Preparar datos para Excel
      const excelData = [
        ['DOCUMENTO', 'CORREO', 'VALIDADO'], // Headers
        ...results.map(result => [
          result.documento || '',
          result.correo || '',
          result.validado ? 'SÍ' : 'NO',
          
        ])
      ];

      // Crear workbook
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(excelData);

      // ✅ SOLUCIÓN: Verificar que worksheet['!ref'] existe antes de usarlo
      if (worksheet['!ref']) {
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        
        // Estilo para headers (primera fila)
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const address = XLSX.utils.encode_cell({ r: 0, c: C });
          if (worksheet[address]) {
            worksheet[address].s = {
              font: { bold: true },
              fill: { fgColor: { rgb: "FFFFAA00" } }
            };
          }
        }
      }

      // Ajustar ancho de columnas
      worksheet['!cols'] = [
        { width: 15 }, // DOCUMENTO
        { width: 30 }, // CORREO
        { width: 10 }, // VALIDADO
        { width: 20 }, // ESTADO
      ];

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Resultados');

      // Guardar archivo
      const fileName = `resultados_${batchId}.xlsx`;
      const filePath = path.join(this.exportsDir, fileName);
      
      XLSX.writeFile(workbook, filePath);

      this.logger.log(`Excel generado: ${filePath}`);
      return filePath;

    } catch (error: any) {
      this.logger.error('Error generando Excel:', error);
      throw new Error(`Error al generar archivo Excel: ${error.message}`);
    }
  }

  private getEstadoText(estado: string): string {
    const estados = {
      'found_in_db': 'Encontrado en BD',
      'validated_api': 'Validado por API',
      'error': 'Error en validación',
    };
    return estados[estado as keyof typeof estados] || 'Desconocido';
  }

  getExportPath(batchId: string): string {
    return path.join(this.exportsDir, `resultados_${batchId}.xlsx`);
  }

  // Método adicional para validar formato del Excel subido
  validateExcelFormat(filePath: string): { isValid: boolean; error?: string } {
    try {
      const workbook = XLSX.readFile(filePath);
      
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        return { isValid: false, error: 'El archivo no contiene hojas válidas' };
      }

      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (!data || data.length < 2) {
        return { isValid: false, error: 'El archivo debe tener al menos 2 filas (header + datos)' };
      }

      // Verificar que las primeras dos columnas tengan datos
      const firstDataRow = data[1] as any[];
      if (!firstDataRow || firstDataRow.length < 2) {
        return { isValid: false, error: 'El archivo debe tener al menos 2 columnas: DOCUMENTO y CORREO' };
      }

      return { isValid: true };
    } catch (error: any) {
      return { isValid: false, error: `Error leyendo archivo: ${error.message}` };
    }
  }

  // Método para limpiar archivos temporales antiguos
  async cleanupOldFiles(olderThanHours: number = 24): Promise<void> {
    try {
      const files = fs.readdirSync(this.exportsDir);
      const now = Date.now();
      const maxAge = olderThanHours * 60 * 60 * 1000; // horas a milisegundos

      for (const file of files) {
        const filePath = path.join(this.exportsDir, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
          this.logger.log(`Archivo eliminado: ${file}`);
        }
      }
    } catch (error) {
      this.logger.error('Error limpiando archivos antiguos:', error);
    }
  }
}