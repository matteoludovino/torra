/** Someone, as lists show them. */
export interface Person {
  id: string;
  name: string;
}

/** One entry of the admins' audit log. */
export interface AuditEntryView {
  id: string;
  actor: Person;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}
