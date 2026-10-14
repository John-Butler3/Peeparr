import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  AddGroupSceneDto,
  CreateGroupDto,
  GroupDetailDto,
  GroupsFeedDto,
  GroupsQueryDto,
  ReorderGroupScenesDto,
  SceneGroupMembershipDto,
  UpdateGroupDto,
} from './dto/groups.dto';
import { GroupsService } from './groups.service';

@Controller('api/groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  getGroups(@Query() query: GroupsQueryDto): Promise<GroupsFeedDto> {
    return this.groupsService.getGroups(query.page, query.perPage, query.query);
  }

  @Get('for-scene/:sceneId')
  getGroupsForScene(@Param('sceneId') sceneId: string): Promise<SceneGroupMembershipDto[]> {
    return this.groupsService.getGroupsForScene(sceneId);
  }

  @Get(':groupId')
  getGroup(@Param('groupId') groupId: string): Promise<GroupDetailDto> {
    return this.groupsService.getGroup(groupId);
  }

  @Post()
  createGroup(@Body() body: CreateGroupDto): Promise<GroupDetailDto> {
    return this.groupsService.createGroup(body);
  }

  @Patch(':groupId')
  updateGroup(
    @Param('groupId') groupId: string,
    @Body() body: UpdateGroupDto,
  ): Promise<GroupDetailDto> {
    return this.groupsService.updateGroup(groupId, body);
  }

  @Delete(':groupId')
  @HttpCode(204)
  deleteGroup(@Param('groupId') groupId: string): Promise<void> {
    return this.groupsService.deleteGroup(groupId);
  }

  @Post(':groupId/scenes')
  addScene(
    @Param('groupId') groupId: string,
    @Body() body: AddGroupSceneDto,
  ): Promise<GroupDetailDto> {
    return this.groupsService.addScene(groupId, body.sceneId);
  }

  @Delete(':groupId/scenes/:sceneId')
  removeScene(
    @Param('groupId') groupId: string,
    @Param('sceneId') sceneId: string,
  ): Promise<GroupDetailDto> {
    return this.groupsService.removeScene(groupId, sceneId);
  }

  @Put(':groupId/scenes/order')
  reorderScenes(
    @Param('groupId') groupId: string,
    @Body() body: ReorderGroupScenesDto,
  ): Promise<GroupDetailDto> {
    return this.groupsService.reorderScenes(groupId, body.sceneIds);
  }
}
