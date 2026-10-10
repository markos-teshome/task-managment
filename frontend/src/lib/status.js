import {
  Ban, CheckCircle2, Circle, CircleDashed, CircleDot, CircleSlash, Clock, PauseCircle, XCircle,
  ChevronsUp, ChevronUp, Equal, ChevronDown, Mail, UserCheck, UserX, Loader,
} from 'lucide-react';

/**
 * One vocabulary for every status in the product: label + tone + icon.
 * Badges always show the label (and an icon), so colour is never the only signal.
 * Tones map to token colours in components/ui/Badge.jsx.
 */
export const PROJECT_STATUS = {
  PLANNING: { label: 'Planning', tone: 'info', icon: CircleDashed },
  ACTIVE: { label: 'Active', tone: 'success', icon: CircleDot },
  ON_HOLD: { label: 'On hold', tone: 'warning', icon: PauseCircle },
  COMPLETED: { label: 'Completed', tone: 'brand', icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: XCircle },
};

export const TASK_STATUS = {
  TODO: { label: 'To do', tone: 'neutral', icon: Circle },
  IN_PROGRESS: { label: 'In progress', tone: 'info', icon: CircleDot },
  BLOCKED: { label: 'Blocked', tone: 'danger', icon: CircleSlash },
  COMPLETED: { label: 'Completed', tone: 'success', icon: CheckCircle2 },
};

export const PRIORITY = {
  URGENT: { label: 'Urgent', tone: 'danger', icon: ChevronsUp },
  HIGH: { label: 'High', tone: 'warning', icon: ChevronUp },
  MEDIUM: { label: 'Medium', tone: 'info', icon: Equal },
  LOW: { label: 'Low', tone: 'neutral', icon: ChevronDown },
};

export const MEMBER_STATUS = {
  ACTIVE: { label: 'Active', tone: 'success', icon: UserCheck },
  INVITED: { label: 'Invited', tone: 'accent', icon: Mail },
  DEACTIVATED: { label: 'Deactivated', tone: 'neutral', icon: UserX },
};

export const PAYMENT_STATUS = {
  PENDING: { label: 'Pending', tone: 'warning', icon: Loader },
  SUCCEEDED: { label: 'Paid', tone: 'success', icon: CheckCircle2 },
  FAILED: { label: 'Failed', tone: 'danger', icon: XCircle },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: Ban },
  EXPIRED: { label: 'Expired', tone: 'neutral', icon: Clock },
};

export const SUBSCRIPTION_STATUS = {
  ACTIVE: { label: 'Active', tone: 'success', icon: CheckCircle2 },
  CANCELED: { label: 'Cancelled', tone: 'neutral', icon: Ban },
  EXPIRED: { label: 'Expired', tone: 'danger', icon: Clock },
};

export const ORG_STATUS = {
  ACTIVE: { label: 'Active', tone: 'success', icon: CheckCircle2 },
  SUSPENDED: { label: 'Suspended', tone: 'danger', icon: Ban },
};

export const options = (map) => Object.entries(map).map(([value, { label }]) => ({ value, label }));

/** Human labels for plan feature flags. */
export const FEATURE_LABELS = {
  DATA_EXPORT: 'CSV data export',
};
