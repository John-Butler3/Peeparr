import {
  RequestOptionsQualityProfileDto,
  RequestOptionsRootFolderDto,
  RequestOptionsTagDto,
} from './request-options.dto';

export class DownloadProfileOptionsDto {
  rootFolders!: RequestOptionsRootFolderDto[];
  qualityProfiles!: RequestOptionsQualityProfileDto[];
  tags!: RequestOptionsTagDto[];
}
