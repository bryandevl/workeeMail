export interface EmailableResponse {
  email: string;
  state: 'deliverable' | 'undeliverable' | 'risky' | 'unknown';
  reason?: string;
  role?: boolean;
  free?: boolean;
  disposable?: boolean;
  accept_all?: boolean;
  mx_record?: string;
  smtp_score?: number;
  overall_score?: number;
  first_name?: string;
  last_name?: string;
  gender?: string;
  country?: string;
  region?: string;
  city?: string;
  zipcode?: string;
  processed_at?: string;
}

export interface ValidationResult {
  documento: string;
  correo: string;
  validado: boolean;
  fuente: 'base_datos' | 'api_validacion' | 'error';
  mensaje: string;
  detalles_api?: EmailableResponse;
}

export interface BulkResult {
  documento: string;
  correo: string;
  validado: boolean;
  estado: 'VALIDO' | 'INVALIDO' | 'ERROR';
  fuente: 'BD' | 'API' | 'ERROR';
}

export interface BulkValidationSummary {
  batchId: number; // ✅ AGREGAR ESTA LÍNEA
  total: number;
  encontrados_en_bd: number;
  validados_por_api: number;
  errores: number;
  resultados: BulkResult[];
}

export interface EmailDataInput {
  documento: string;
  correo: string;
}
