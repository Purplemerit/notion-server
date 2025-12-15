import { Module } from '@nestjs/common';
import { WhiteboardGateway } from './whiteboard.gateway';

@Module({
  providers: [WhiteboardGateway],
  exports: [WhiteboardGateway],
})
export class WhiteboardModule {}
