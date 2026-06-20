import { STATUS_LABELS } from '../../../shared/constants';
import type { SampleStatus } from '../../../shared/types';

interface StatusBadgeProps {
  status: SampleStatus;
}

const badgeClass: Record<SampleStatus, string> = {
  imported: 'status-badge-imported',
  in_stock: 'status-badge-in_stock',
  in_transit: 'status-badge-in_transit',
  testing: 'status-badge-testing',
  tested: 'status-badge-tested',
  archived: 'status-badge-archived',
  rolled_back: 'status-badge-rolled_back',
};

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  return <span className={badgeClass[status]}>{STATUS_LABELS[status]}</span>;
};
