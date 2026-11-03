import compression from 'compression';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';
import { applyHttpSecurity } from './security/http-security';
import { resolveNestLogLevels } from './logging/log-levels';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: resolveNestLogLevels(),
  });
  const logger = new Logger('Bootstrap');
  // Before anything else: proxy trust, security headers, cross-site checks.
  applyHttpSecurity(app);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Pages, code and API answers compressed (brotli or gzip). Not videos and
  // pictures: they're compressed already, and video is sent in ranges.
  app.use(
    compression({
      threshold: 1024,
      filter: (request, response) =>
        !request.path.startsWith('/api/media/') &&
        compression.filter(request, response),
    }),
  );

  if (process.env.NODE_ENV === 'production') {
    const staticAssetsPath = join(
      process.cwd(),
      'apps/sp-web/dist/sp-web/browser',
    );
    const indexFilePath = join(staticAssetsPath, 'index.html');

    if (existsSync(indexFilePath)) {
      app.useStaticAssets(staticAssetsPath, {
        index: false,
        setHeaders: (response, file) => {
          // Built files are named by their content: a new version is a new
          // name, so each can be kept for good.
          if (/-[A-Z0-9]{8}\.(js|css)$/.test(file)) {
            response.setHeader(
              'Cache-Control',
              'public, max-age=31536000, immutable',
            );
          } else {
            response.setHeader('Cache-Control', 'public, max-age=86400');
          }
        },
      });
      app
        .getHttpAdapter()
        .getInstance()
        .get(/^\/(?!api(?:\/|$)).*/, (req: Request, res: Response) => {
          if (extname(req.path)) {
            res.status(404).end();
            return;
          }

          // Always checked (it names the current build's files).
          res.setHeader('Cache-Control', 'no-cache');
          res.sendFile(indexFilePath);
        });
    } else {
      logger.warn(`Static frontend build not found at ${staticAssetsPath}`);
    }
  }

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  await app.listen(port, host);
}
void bootstrap();
