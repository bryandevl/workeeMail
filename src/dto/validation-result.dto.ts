export class ValidationResultDto {
  documento: string;
  correo: string;
  validado: boolean;
  estado: 'found_in_db' | 'validated_api' | 'error';
  api_response?: any;
}