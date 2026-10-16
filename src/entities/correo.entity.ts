import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('correo')
@Index(['documento'])
@Index(['correo'])
@Index(['documento', 'correo'])
@Index(['validado'])
export class Correo {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  documento: string;

  @Column({ type: 'varchar', length: 255 })
  correo: string;

  @Column({ type: 'boolean', default: false })
  validado: boolean;

  @CreateDateColumn({ type: 'timestamp', nullable: true })
  created_at?: Date;

  @UpdateDateColumn({ type: 'timestamp', nullable: true })
  updated_at?: Date;
}