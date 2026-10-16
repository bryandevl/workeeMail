import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  // ✅ Registrar multipart con @ts-ignore
  await app.register(
    // @ts-ignore
    require('@fastify/multipart'),
    {
      limits: {
        fieldNameSize: 100,
        fieldSize: 1000000,
        fields: 10,
        fileSize: 52428800, // 50MB
        files: 1,
        headerPairs: 2000,
      },
    },
  );

app.enableCors({
    origin: '*', // En producción, especifica tu dominio
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Application is running on: http://localhost:${port}`);
}

bootstrap();