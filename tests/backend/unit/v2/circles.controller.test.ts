import type { Request } from 'express';
import { RoomsController } from '@server/api/v2/rooms/rooms.controller';

describe('circle first-post prompt updates', () => {
  it.each([
    [{ room_prompt: null }, null],
    [{ room_prompt: null, }, null],
    [{ room_prompt: null }, null],
    [{ room_prompt: 'New prompt', }, 'New prompt'],
    [{ room_prompt: 'Legacy prompt' }, 'Legacy prompt'],
    [{}, undefined],
  ])('preserves explicit clearing and omitted-field semantics: %j', async (body, expected) => {
    const updateFirstPostPrompts = vi.fn().mockResolvedValue({
      room_prompt: null, effective_room_prompt: 'Default', default_prompt: 'Default', members: [],
    });
    const controller = new RoomsController();
    Object.assign(controller, {
      communityBannersService: { updateFirstPostPrompts },
    });
    await controller.updateFirstPostPrompts('42', { user: { id: 7 } } as unknown as Request, body);
    expect(updateFirstPostPrompts).toHaveBeenCalledWith(42, 7, {
      roomPrompt: expected, memberPrompts: [],
    });
  });
});
