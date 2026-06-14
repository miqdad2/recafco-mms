export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      departments: {
        Row: {
          id: string;
          name: string;
          code: string;
          description: string | null;
          manager_name: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          code: string;
          description?: string | null;
          manager_name?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["departments"]["Insert"]>;
      };
      roles: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          is_system: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          description?: string | null;
          is_system?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["roles"]["Insert"]>;
      };
      permissions: {
        Row: {
          id: string;
          key: string;
          description: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          description: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["permissions"]["Insert"]>;
      };
      role_permissions: {
        Row: {
          role_id: string;
          permission_id: string;
          created_at: string;
        };
        Insert: {
          role_id: string;
          permission_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["role_permissions"]["Insert"]>;
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          employee_number: string | null;
          phone: string | null;
          job_title: string | null;
          department_id: string | null;
          role_id: string | null;
          is_active: boolean;
          can_view_costs: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          employee_number?: string | null;
          phone?: string | null;
          job_title?: string | null;
          department_id?: string | null;
          role_id?: string | null;
          is_active?: boolean;
          can_view_costs?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      app_settings: {
        Row: {
          id: string;
          company_name: string;
          default_currency: string;
          work_order_number_format: string;
          parts_request_number_format: string;
          purchase_request_number_format: string;
          ceo_approval_threshold: number;
          requester_confirmation_enabled: boolean;
          finance_approval_enabled: boolean;
          ceo_approval_enabled: boolean;
          logo_path: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          company_name?: string;
          default_currency?: string;
          work_order_number_format?: string;
          parts_request_number_format?: string;
          purchase_request_number_format?: string;
          ceo_approval_threshold?: number;
          requester_confirmation_enabled?: boolean;
          finance_approval_enabled?: boolean;
          ceo_approval_enabled?: boolean;
          logo_path?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["app_settings"]["Insert"]>;
      };
      audit_logs: {
        Row: {
          id: string;
          actor_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          summary: string;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          summary: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: never;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type RoleSlug =
  | "super_admin"
  | "it_admin"
  | "ceo_management"
  | "maintenance_manager"
  | "maintenance_supervisor"
  | "maintenance_data_entry"
  | "technician"
  | "store_keeper"
  | "purchase_officer"
  | "finance_manager"
  | "cost_controller"
  | "accounting_reviewer"
  | "department_requester"
  | "viewer_auditor";

export type PermissionKey =
  | "dashboard.view"
  | "admin.users.manage"
  | "admin.roles.view"
  | "admin.departments.manage"
  | "admin.settings.manage"
  | "admin.notification_settings.manage"
  | "admin.audit_logs.view"
  | "admin.system_health.view"
  | "admin.system_health.manage"
  | "system_map.view"
  | "architecture.view"
  | "costs.view"
  | "assets.view"
  | "assets.manage"
  | "parts.view"
  | "parts.manage"
  | "work_orders.view"
  | "work_orders.manage"
  | "work_orders.print"
  | "work_orders.approve"
  | "work_orders.assign"
  | "technician.jobs.view"
  | "technician.jobs.update"
  | "notifications.view"
  | "parts_requests.view"
  | "parts_requests.create"
  | "parts_requests.approve"
  | "store.issue"
  | "inventory.movements.view"
  | "purchase_requests.view"
  | "purchase_requests.manage"
  | "finance.approve"
  | "ceo.approve"
  | "finance.reports.view"
  | "cost.review"
  | "cost.approve"
  | "cost.reports.view"
  | "budget.check"
  | "cost_center.manage"
  | "reports.view"
  | "reports.export"
  | "files.upload"
  | "files.view";
