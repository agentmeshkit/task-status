export type TaskLifecycleStatus =
  | 'Researching'
  | 'Planning'
  | 'Building'
  | 'Testing'
  | 'Review'
  | 'Deployment'
  | 'Done'
  | 'Needs Human';

export interface TaskStatusSnapshot {
  task: string;
  status: TaskLifecycleStatus;
  summary?: string;
  updatedAt: string;
}

