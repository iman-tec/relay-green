/* Department command center types — mirror /api/department/employees. */

export type DeptEmployee = {
  id: string;
  displayName: string;
  email: string;
  clientType: string;
  status: string;
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  createdAt: string;
};

export type DeptData = {
  department: {
    id: string;
    name: string;
    departmentCode: string;
    status: string;
    allocatedMinutes: number;
    usedMinutes: number;
    remainingMinutes: number;
  };
  enterprise: { id: string; name: string; enterpriseCode: string };
  employees: DeptEmployee[];
};

export type DeptTab =
  | "overview"
  | "supervise"
  | "usage"
  | "settings"
  | "resources";
