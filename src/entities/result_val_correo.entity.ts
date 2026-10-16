import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('Resul_val_correo')
export class Resul_val_correo {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  usuario: string;

  @Column({ type: 'varchar', length: 255 })
  campania: string;

  @Column({ type: 'varchar', length: 255 })
  vali_total: string;

  @Column({ type: 'varchar', length: 255 })
  vali_interno: string;

  @Column({ name: 'progreso', type: 'int', default: 1 })
  progreso: number;

  @Column({ type: 'varchar', length: 255 })
  vali_api: string;

  @Column({ type: 'varchar', length: 255 })
  correos_validos: string;

  @Column({ type: 'varchar', length: 255 })
  correos_invalidos: string;

  @CreateDateColumn({ type: 'timestamp', nullable: true })
  fecha_registra?: Date;



}