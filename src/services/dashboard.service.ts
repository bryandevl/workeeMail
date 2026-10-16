import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { Resul_val_correo } from '../entities/result_val_correo.entity';

export interface CampaignSummaryDto {
  campania: string;
  total_vali_total: number;
  total_vali_interno: number;
  total_vali_api: number;
  total_correos_validos: number;
  total_correos_invalidos: number;
  fecha_actualizacion: Date;
  success_rate: number;
}

export interface FilterDto {
  startDate?: string;
  endDate?: string;
  campaigns?: string[];
  period?: 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
  usuario?: string;
}

export interface TotalStatsDto {
  total_campaigns: number;
  total_validations: number;
  total_valid_emails: number;
  total_invalid_emails: number;
  success_rate: number;
  total_records: number;
  first_record: Date;
  last_record: Date;
}

export interface TrendDataDto {
  fecha: string;
  total_validations: number;
  valid_emails: number;
  invalid_emails: number;
  success_rate: number;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Resul_val_correo)
    private readonly resulValCorreoRepository: Repository<Resul_val_correo>,
  ) {}

  /**
   * Obtener resumen de campañas con filtros
   */
  async getCampaignSummary(filters: FilterDto): Promise<CampaignSummaryDto[]> {
    const queryBuilder = this.resulValCorreoRepository
      .createQueryBuilder('r')
      .select([
        'r.campania as campania',
        'SUM(CAST(r.vali_total AS UNSIGNED)) as total_vali_total',
        'SUM(CAST(r.vali_interno AS UNSIGNED)) as total_vali_interno',
        'SUM(CAST(r.vali_api AS UNSIGNED)) as total_vali_api',
        'SUM(CAST(r.correos_validos AS UNSIGNED)) as total_correos_validos',
        'SUM(CAST(r.correos_invalidos AS UNSIGNED)) as total_correos_invalidos',
        'MAX(r.fecha_registra) as fecha_actualizacion',
      ])
      .groupBy('r.campania')
      .orderBy('fecha_actualizacion', 'DESC');

    // Aplicar filtros de fecha
    this.applyDateFilters(queryBuilder, filters);

    // Filtrar por campañas específicas
    if (filters.campaigns && filters.campaigns.length > 0) {
      queryBuilder.andWhere('r.campania IN (:...campaigns)', {
        campaigns: filters.campaigns,
      });
    }

    // Filtrar por usuario si se proporciona
    if (filters.usuario) {
      queryBuilder.andWhere('r.usuario = :usuario', {
        usuario: filters.usuario,
      });
    }

    const results = await queryBuilder.getRawMany();

    // Calcular la tasa de éxito y convertir tipos
    return results.map((result) => {
      const validEmails = parseInt(result.total_correos_validos) || 0;
      const invalidEmails = parseInt(result.total_correos_invalidos) || 0;
      const totalEmails = validEmails + invalidEmails;
      const successRate = totalEmails > 0 ? (validEmails / totalEmails) * 100 : 0;

      return {
        campania: result.campania,
        total_vali_total: parseInt(result.total_vali_total) || 0,
        total_vali_interno: parseInt(result.total_vali_interno) || 0,
        total_vali_api: parseInt(result.total_vali_api) || 0,
        total_correos_validos: validEmails,
        total_correos_invalidos: invalidEmails,
        fecha_actualizacion: result.fecha_actualizacion,
        success_rate: Math.round(successRate * 100) / 100,
      };
    });
  }

  /**
   * Obtener resumen total con filtros
   */
  async getTotalSummary(filters: FilterDto): Promise<CampaignSummaryDto> {
    const queryBuilder = this.resulValCorreoRepository
      .createQueryBuilder('r')
      .select([
        "'TOTAL GENERAL' as campania",
        'SUM(CAST(r.vali_total AS UNSIGNED)) as total_vali_total',
        'SUM(CAST(r.vali_interno AS UNSIGNED)) as total_vali_interno',
        'SUM(CAST(r.vali_api AS UNSIGNED)) as total_vali_api',
        'SUM(CAST(r.correos_validos AS UNSIGNED)) as total_correos_validos',
        'SUM(CAST(r.correos_invalidos AS UNSIGNED)) as total_correos_invalidos',
        'MAX(r.fecha_registra) as fecha_actualizacion',
      ]);

    // Aplicar los mismos filtros
    this.applyDateFilters(queryBuilder, filters);

    if (filters.campaigns && filters.campaigns.length > 0) {
      queryBuilder.andWhere('r.campania IN (:...campaigns)', {
        campaigns: filters.campaigns,
      });
    }

    if (filters.usuario) {
      queryBuilder.andWhere('r.usuario = :usuario', {
        usuario: filters.usuario,
      });
    }

    const result = await queryBuilder.getRawOne();

    if (!result) {
      return {
        campania: 'TOTAL GENERAL',
        total_vali_total: 0,
        total_vali_interno: 0,
        total_vali_api: 0,
        total_correos_validos: 0,
        total_correos_invalidos: 0,
        fecha_actualizacion: new Date(),
        success_rate: 0,
      };
    }

    const validEmails = parseInt(result.total_correos_validos) || 0;
    const invalidEmails = parseInt(result.total_correos_invalidos) || 0;
    const totalEmails = validEmails + invalidEmails;
    const successRate = totalEmails > 0 ? (validEmails / totalEmails) * 100 : 0;

    return {
      campania: 'TOTAL GENERAL',
      total_vali_total: parseInt(result.total_vali_total) || 0,
      total_vali_interno: parseInt(result.total_vali_interno) || 0,
      total_vali_api: parseInt(result.total_vali_api) || 0,
      total_correos_validos: validEmails,
      total_correos_invalidos: invalidEmails,
      fecha_actualizacion: result.fecha_actualizacion || new Date(),
      success_rate: Math.round(successRate * 100) / 100,
    };
  }

  /**
   * Obtener estadísticas generales
   */
  async getStats(filters: FilterDto): Promise<TotalStatsDto> {
    const queryBuilder = this.resulValCorreoRepository
      .createQueryBuilder('r')
      .select([
        'COUNT(DISTINCT r.campania) as total_campaigns',
        'SUM(CAST(r.vali_total AS UNSIGNED)) as total_validations',
        'SUM(CAST(r.correos_validos AS UNSIGNED)) as total_valid_emails',
        'SUM(CAST(r.correos_invalidos AS UNSIGNED)) as total_invalid_emails',
        'COUNT(*) as total_records',
        'MIN(r.fecha_registra) as first_record',
        'MAX(r.fecha_registra) as last_record',
      ]);

    this.applyDateFilters(queryBuilder, filters);

    if (filters.campaigns && filters.campaigns.length > 0) {
      queryBuilder.andWhere('r.campania IN (:...campaigns)', {
        campaigns: filters.campaigns,
      });
    }

    if (filters.usuario) {
      queryBuilder.andWhere('r.usuario = :usuario', {
        usuario: filters.usuario,
      });
    }

    const result = await queryBuilder.getRawOne();

    const validEmails = parseInt(result.total_valid_emails) || 0;
    const invalidEmails = parseInt(result.total_invalid_emails) || 0;
    const totalEmails = validEmails + invalidEmails;
    const successRate = totalEmails > 0 ? (validEmails / totalEmails) * 100 : 0;

    return {
      total_campaigns: parseInt(result.total_campaigns) || 0,
      total_validations: parseInt(result.total_validations) || 0,
      total_valid_emails: validEmails,
      total_invalid_emails: invalidEmails,
      success_rate: Math.round(successRate * 100) / 100,
      total_records: parseInt(result.total_records) || 0,
      first_record: result.first_record,
      last_record: result.last_record,
    };
  }

  /**
   * Obtener campañas disponibles
   */
  async getAvailableCampaigns(usuario?: string): Promise<string[]> {
    const queryBuilder = this.resulValCorreoRepository
      .createQueryBuilder('r')
      .select('DISTINCT r.campania', 'campania')
      .orderBy('r.campania', 'ASC');

    if (usuario) {
      queryBuilder.where('r.usuario = :usuario', { usuario });
    }

    const results = await queryBuilder.getRawMany();
    return results.map((result) => result.campania);
  }

  /**
   * Obtener datos de tendencias por día
   */
  async getTrends(days: number = 30, filters: FilterDto): Promise<TrendDataDto[]> {
    const queryBuilder = this.resulValCorreoRepository
      .createQueryBuilder('r')
      .select([
        'DATE(r.fecha_registra) as fecha',
        'SUM(CAST(r.vali_total AS UNSIGNED)) as total_validations',
        'SUM(CAST(r.correos_validos AS UNSIGNED)) as valid_emails',
        'SUM(CAST(r.correos_invalidos AS UNSIGNED)) as invalid_emails',
      ])
      .where('r.fecha_registra >= DATE_SUB(CURDATE(), INTERVAL :days DAY)', {
        days,
      })
      .groupBy('DATE(r.fecha_registra)')
      .orderBy('fecha', 'DESC');

    if (filters.campaigns && filters.campaigns.length > 0) {
      queryBuilder.andWhere('r.campania IN (:...campaigns)', {
        campaigns: filters.campaigns,
      });
    }

    if (filters.usuario) {
      queryBuilder.andWhere('r.usuario = :usuario', {
        usuario: filters.usuario,
      });
    }

    const results = await queryBuilder.getRawMany();

    return results.map((result) => {
      const validEmails = parseInt(result.valid_emails) || 0;
      const invalidEmails = parseInt(result.invalid_emails) || 0;
      const totalEmails = validEmails + invalidEmails;
      const successRate = totalEmails > 0 ? (validEmails / totalEmails) * 100 : 0;

      return {
        fecha: result.fecha,
        total_validations: parseInt(result.total_validations) || 0,
        valid_emails: validEmails,
        invalid_emails: invalidEmails,
        success_rate: Math.round(successRate * 100) / 100,
      };
    });
  }

  /**
   * Aplicar filtros de fecha basados en el período o fechas personalizadas
   */
  private applyDateFilters(queryBuilder: any, filters: FilterDto): void {
    if (filters.period && filters.period !== 'custom') {
      switch (filters.period) {
        case 'today':
          queryBuilder.andWhere('DATE(r.fecha_registra) = CURDATE()');
          break;
        case 'week':
          queryBuilder.andWhere(
            'r.fecha_registra >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)',
          );
          break;
        case 'month':
          queryBuilder.andWhere(
            'r.fecha_registra >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)',
          );
          break;
        case 'quarter':
          queryBuilder.andWhere(
            'r.fecha_registra >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)',
          );
          break;
        case 'year':
          queryBuilder.andWhere(
            'r.fecha_registra >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)',
          );
          break;
      }
    } else if (
      filters.period === 'custom' &&
      filters.startDate &&
      filters.endDate
    ) {
      queryBuilder.andWhere(
        'DATE(r.fecha_registra) BETWEEN :startDate AND :endDate',
        {
          startDate: filters.startDate,
          endDate: filters.endDate,
        },
      );
    }
  }

  /**
   * Obtener usuarios disponibles (si necesitas filtrar por usuario)
   */
  async getAvailableUsers(): Promise<string[]> {
    const results = await this.resulValCorreoRepository
      .createQueryBuilder('r')
      .select('DISTINCT r.usuario', 'usuario')
      .orderBy('r.usuario', 'ASC')
      .getRawMany();

    return results.map((result) => result.usuario);
  }


 /**
   * Obtiene todas las campañas distintas
   * @returns Promise<string[]> - Array de campañas únicas
   */
  async getDistinctCampanias(): Promise<string[]> {
    const result = await this.resulValCorreoRepository
      .createQueryBuilder('Resul_val_correo')
      .select('DISTINCT Resul_val_correo.campania', 'campania')
      .getRawMany();

    return result.map(item => item.campania);
  }



}