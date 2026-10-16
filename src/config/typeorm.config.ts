import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Correo } from '../entities/correo.entity';
import { Resul_val_correo } from '../entities/result_val_correo.entity';

export const getTypeOrmConfig = (configService: ConfigService): TypeOrmModuleOptions => ({
  type: 'mysql',
  host: configService.get<string>('HOST'),
  port: configService.get<number>('PORT_DB'),
  username: configService.get<string>('USER_NAME'),
  password: configService.get<string>('PASSWORD'),
  database: configService.get<string>('DATABASE'),
  entities: [Correo, Resul_val_correo], // ← importación directa, sin glob
  synchronize: false,
  logging: configService.get<string>('NODE_ENV') === 'development',
  timezone: '-05:00',
  charset: 'utf8mb4',
  extra: {
    connectionLimit: 10,
  },
});