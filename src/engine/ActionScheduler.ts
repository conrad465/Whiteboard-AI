import type { WhiteboardAction } from "../schema/types";

// -----------------------------------------------------------------------------
// ActionScheduler — simple lookup table: actionId → WhiteboardAction
// WhiteboardPlayer uses this to retrieve the full action when BoundaryTracker
// fires a start callback.
// -----------------------------------------------------------------------------

export class ActionScheduler {
  private actionMap = new Map<string, WhiteboardAction>();

  constructor(actions: WhiteboardAction[]) {
    for (const action of actions) {
      if (this.actionMap.has(action.action_id)) {
        console.warn(`ActionScheduler: duplicate action_id "${action.action_id}" — keeping last`);
      }
      this.actionMap.set(action.action_id, action);
    }
  }

  getAction(actionId: string): WhiteboardAction | undefined {
    return this.actionMap.get(actionId);
  }

  getAllActions(): WhiteboardAction[] {
    return Array.from(this.actionMap.values());
  }
}
