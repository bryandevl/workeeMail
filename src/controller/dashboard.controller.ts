import {
  Controller,
  Get,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import {
  DashboardService,
  CampaignSummaryDto,
  FilterDto,
  TotalStatsDto,
  TrendDataDto,
} from '../services/dashboard.service';

@ApiTags('Dashboard')
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('campaigns')
  @ApiOperation({ summary: 'Obtener resumen de campañas con filtros' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'campaigns', required: false, type: String })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month', 'quarter', 'year', 'custom'] })
  @ApiQuery({ name: 'usuario', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Lista de campañas con resumen' })
  async getCampaigns(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('campaigns') campaigns?: string,
    @Query('period') period?: 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom',
    @Query('usuario') usuario?: string,
  ): Promise<CampaignSummaryDto[]> {
    try {
      const filters: FilterDto = {
        startDate,
        endDate,
        campaigns: campaigns ? campaigns.split(',').map(c => c.trim()) : undefined,
        period,
        usuario,
      };

      // Validar fechas si es período personalizado
      if (period === 'custom') {
        if (!startDate || !endDate) {
          throw new BadRequestException(
            'Las fechas de inicio y fin son requeridas para el período personalizado',
          );
        }

        if (new Date(startDate) > new Date(endDate)) {
          throw new BadRequestException(
            'La fecha de inicio no puede ser mayor que la fecha de fin',
          );
        }
      }

      return await this.dashboardService.getCampaignSummary(filters);
    } catch (error) {
      throw new BadRequestException(`Error al obtener campañas: ${error.message}`);
    }
  }

  @Get('campaigns/summary')
  @ApiOperation({ summary: 'Obtener resumen total de todas las campañas' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'campaigns', required: false, type: String })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month', 'quarter', 'year', 'custom'] })
  @ApiQuery({ name: 'usuario', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Resumen total de campañas' })
  async getCampaignsSummary(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('campaigns') campaigns?: string,
    @Query('period') period?: 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom',
    @Query('usuario') usuario?: string,
  ): Promise<CampaignSummaryDto> {
    try {
      const filters: FilterDto = {
        startDate,
        endDate,
        campaigns: campaigns ? campaigns.split(',').map(c => c.trim()) : undefined,
        period,
        usuario,
      };

      return await this.dashboardService.getTotalSummary(filters);
    } catch (error) {
      throw new BadRequestException(`Error al obtener resumen: ${error.message}`);
    }
  }

  @Get('stats')
  @ApiOperation({ summary: 'Obtener estadísticas generales del dashboard' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'campaigns', required: false, type: String })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month', 'quarter', 'year', 'custom'] })
  @ApiQuery({ name: 'usuario', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Estadísticas generales' })
  async getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('campaigns') campaigns?: string,
    @Query('period') period?: 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom',
    @Query('usuario') usuario?: string,
  ): Promise<TotalStatsDto> {
    try {
      const filters: FilterDto = {
        startDate,
        endDate,
        campaigns: campaigns ? campaigns.split(',').map(c => c.trim()) : undefined,
        period,
        usuario,
      };

      return await this.dashboardService.getStats(filters);
    } catch (error) {
      throw new BadRequestException(`Error al obtener estadísticas: ${error.message}`);
    }
  }

 
  @Get('trends')
  @ApiOperation({ summary: 'Obtener datos de tendencias por día' })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Número de días hacia atrás (default: 30)' })
  @ApiQuery({ name: 'campaigns', required: false, type: String })
  @ApiQuery({ name: 'usuario', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Datos de tendencias por día' })
  async getTrends(
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
    @Query('campaigns') campaigns?: string,
    @Query('usuario') usuario?: string,
  ): Promise<TrendDataDto[]> {
    try {
      if (days < 1 || days > 365) {
        throw new BadRequestException('El número de días debe estar entre 1 y 365');
      }

      const filters: FilterDto = {
        campaigns: campaigns ? campaigns.split(',').map(c => c.trim()) : undefined,
        usuario,
      };

      return await this.dashboardService.getTrends(days, filters);
    } catch (error) {
      throw new BadRequestException(`Error al obtener tendencias: ${error.message}`);
    }
  }



  @Get('export/csv')
  @ApiOperation({ summary: 'Exportar datos del dashboard a CSV' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'campaigns', required: false, type: String })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month', 'quarter', 'year', 'custom'] })
  @ApiQuery({ name: 'usuario', required: false, type: String })
  async exportToCSV(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('campaigns') campaigns?: string,
    @Query('period') period?: 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom',
    @Query('usuario') usuario?: string,
  ): Promise<{ data: CampaignSummaryDto[]; filename: string }> {
    try {
      const filters: FilterDto = {
        startDate,
        endDate,
        campaigns: campaigns ? campaigns.split(',').map(c => c.trim()) : undefined,
        period,
        usuario,
      };

      const data = await this.dashboardService.getCampaignSummary(filters);
      const filename = `campañas_${new Date().toISOString().split('T')[0]}.csv`;

      return { data, filename };
    } catch (error) {
      throw new BadRequestException(`Error al exportar datos: ${error.message}`);
    }
  }


@Get('campanias-val')
async getCampanias() {
 
  const result = await this.dashboardService.getDistinctCampanias();
  
  return result;
}


@Get('test')
async test() {
  return { message: 'Dashboard controller funcionando' };
}

}