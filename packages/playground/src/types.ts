export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdBy: string;
  completedBy?: string;
  urgent: boolean;
  createdAt: number;
}

export interface TodoAddPayload {
  id: string;
  text: string;
  createdBy: string;
  urgent: boolean;
  createdAt: number;
}

export interface TodoCompletePayload {
  id: string;
  completedBy: string;
}

export interface TodoDeletePayload {
  id: string;
  deletedBy: string;
}

export interface NotificationPayload {
  message: string;
  from: string;
}

export interface ActivityEntry {
  id: string;
  type: string;
  source: 'local' | 'remote';
  sourceTabId: string;
  timestamp: number;
  payload: unknown;
}
