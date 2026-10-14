import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { WhisparrMetadataService } from './whisparr-metadata.service';

/**
 * Mirrors the route contract of Whisparr's own "WhisparrMetadata" service
 * (default https://api.whisparr.com/v4/{route}) for the Scene/Performer/Site
 * routes, backed by TPDB. Point Whisparr's WhisparrMetadata config at this
 * controller's base URL (e.g. http://<portal-host>/api/whisparr-metadata/{route})
 * to make Whisparr search/pull scenes and performers from TPDB.
 *
 * Static routes (search/changed) are declared before the :id param routes on
 * the same prefix so they aren't shadowed.
 *
 * @Public(): Whisparr calls these routes directly with no session cookie, so
 * they must bypass the app's global AdminSessionGuard. Keep this reachable
 * only from trusted networks (e.g. not exposed past your firewall) — it has
 * no auth of its own beyond that.
 */
@Controller('api/whisparr-metadata')
@Public()
export class WhisparrMetadataController {
  constructor(private readonly whisparrMetadataService: WhisparrMetadataService) {}

  @Get('scene/search')
  searchScenes(@Query('q') query?: string) {
    return this.whisparrMetadataService.searchScenes(this.requireQuery(query));
  }

  @Get('scene/changed')
  getScenesChanged() {
    return this.whisparrMetadataService.getScenesChanged();
  }

  @Get('scene/:id')
  getScene(@Param('id') id: string) {
    return this.whisparrMetadataService.getScene(id);
  }

  @Get('performer/search')
  searchPerformers(@Query('q') query?: string) {
    return this.whisparrMetadataService.searchPerformers(this.requireQuery(query));
  }

  @Get('performer/changed')
  getPerformersChanged() {
    return this.whisparrMetadataService.getPerformersChanged();
  }

  @Get('performer/:id/works')
  getPerformerWorks(@Param('id') id: string) {
    return this.whisparrMetadataService.getPerformerWorks(id);
  }

  @Get('performer/:id')
  getPerformer(@Param('id') id: string) {
    return this.whisparrMetadataService.getPerformer(id);
  }

  @Get('site/search')
  searchSites(@Query('q') query?: string) {
    return this.whisparrMetadataService.searchSites(this.requireQuery(query));
  }

  @Get('site/changed')
  getSitesChanged() {
    return this.whisparrMetadataService.getSitesChanged();
  }

  @Get('site/:id/scenes')
  getSiteScenes(@Param('id') id: string) {
    return this.whisparrMetadataService.getSiteScenes(id);
  }

  @Get('site/:id/works')
  getSiteWorks(@Param('id') id: string) {
    return this.whisparrMetadataService.getSiteWorks(id);
  }

  @Get('site/:id')
  getSite(@Param('id') id: string) {
    return this.whisparrMetadataService.getSite(id);
  }

  private requireQuery(query: string | undefined): string {
    const normalized = query?.trim() ?? '';
    if (!normalized) {
      throw new BadRequestException('Query parameter "q" is required.');
    }
    return normalized;
  }
}
