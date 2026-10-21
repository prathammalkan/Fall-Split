// Complete database type definitions for Fall Split
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          bio: string | null;
          upi_id: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          username: string;
          display_name: string;
          avatar_url?: string | null;
          bio?: string | null;
          upi_id?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          username?: string;
          display_name?: string;
          avatar_url?: string | null;
          bio?: string | null;
          upi_id?: string | null;
          updated_at?: string;
          deleted_at?: string | null;
        };
      };
      friend_requests: {
        Row: {
          id: string;
          sender_id: string;
          receiver_id: string;
          status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'blocked';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sender_id: string;
          receiver_id: string;
          status?: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'blocked';
        };
        Update: {
          status?: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'blocked';
          updated_at?: string;
        };
      };
      invitation_tokens: {
        Row: {
          id: string;
          token: string;
          type: 'friend' | 'group';
          creator_id: string;
          target_id: string | null;
          max_uses: number;
          use_count: number;
          expires_at: string | null;
          created_at: string;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          token?: string;
          type: 'friend' | 'group';
          creator_id: string;
          target_id?: string | null;
          max_uses?: number;
          use_count?: number;
          expires_at?: string | null;
          revoked_at?: string | null;
        };
        Update: {
          use_count?: number;
          revoked_at?: string | null;
        };
      };
      groups: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          type: 'trip' | 'household' | 'event' | 'custom';
          currency: string;
          creator_id: string;
          avatar_url: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          type?: 'trip' | 'household' | 'event' | 'custom';
          currency?: string;
          creator_id: string;
          avatar_url?: string | null;
          archived_at?: string | null;
        };
        Update: {
          name?: string;
          description?: string | null;
          type?: 'trip' | 'household' | 'event' | 'custom';
          currency?: string;
          avatar_url?: string | null;
          archived_at?: string | null;
          updated_at?: string;
        };
      };
      group_members: {
        Row: {
          id: string;
          group_id: string;
          user_id: string;
          role: 'admin' | 'member';
          invited_by: string | null;
          joined_at: string;
          removed_at: string | null;
        };
        Insert: {
          id?: string;
          group_id: string;
          user_id: string;
          role?: 'admin' | 'member';
          invited_by?: string | null;
          removed_at?: string | null;
        };
        Update: {
          role?: 'admin' | 'member';
          removed_at?: string | null;
        };
      };
      expenses: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          amount_paise: number;
          currency: string;
          split_method: 'equal' | 'unequal' | 'percentage' | 'shares' | 'itemized' | 'manual';
          group_id: string | null;
          creator_id: string;
          expense_date: string;
          category: string | null;
          notes: string | null;
          receipt_url: string | null;
          status: 'active' | 'voided' | 'deleted';
          idempotency_key: string | null;
          created_at: string;
          updated_at: string;
          voided_at: string | null;
          voided_by: string | null;
          void_reason: string | null;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          amount_paise: number;
          currency?: string;
          split_method?: 'equal' | 'unequal' | 'percentage' | 'shares' | 'itemized' | 'manual';
          group_id?: string | null;
          creator_id: string;
          expense_date?: string;
          category?: string | null;
          notes?: string | null;
          receipt_url?: string | null;
          status?: 'active' | 'voided' | 'deleted';
          idempotency_key?: string | null;
        };
        Update: {
          title?: string;
          description?: string | null;
          amount_paise?: number;
          currency?: string;
          split_method?: 'equal' | 'unequal' | 'percentage' | 'shares' | 'itemized' | 'manual';
          expense_date?: string;
          category?: string | null;
          notes?: string | null;
          receipt_url?: string | null;
          status?: 'active' | 'voided' | 'deleted';
          voided_at?: string | null;
          voided_by?: string | null;
          void_reason?: string | null;
          updated_at?: string;
        };
      };
      expense_payers: {
        Row: {
          id: string;
          expense_id: string;
          user_id: string;
          amount_paise: number;
        };
        Insert: {
          id?: string;
          expense_id: string;
          user_id: string;
          amount_paise: number;
        };
        Update: {
          amount_paise?: number;
        };
      };
      expense_shares: {
        Row: {
          id: string;
          expense_id: string;
          user_id: string;
          amount_paise: number;
          share_weight: number | null;
          percentage: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          expense_id: string;
          user_id: string;
          amount_paise: number;
          share_weight?: number | null;
          percentage?: number | null;
        };
        Update: {
          amount_paise?: number;
          share_weight?: number | null;
          percentage?: number | null;
          updated_at?: string;
        };
      };
      expense_items: {
        Row: {
          id: string;
          expense_id: string;
          name: string;
          quantity: number;
          unit_price_paise: number;
          total_paise: number;
          item_type: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          expense_id: string;
          name: string;
          quantity?: number;
          unit_price_paise: number;
          total_paise: number;
          item_type?: string;
          sort_order?: number;
        };
        Update: {
          name?: string;
          quantity?: number;
          unit_price_paise?: number;
          total_paise?: number;
          item_type?: string;
          sort_order?: number;
        };
      };
      expense_item_allocations: {
        Row: {
          id: string;
          item_id: string;
          user_id: string;
          amount_paise: number;
        };
        Insert: {
          id?: string;
          item_id: string;
          user_id: string;
          amount_paise: number;
        };
        Update: {
          amount_paise?: number;
        };
      };
      expense_history: {
        Row: {
          id: string;
          expense_id: string;
          changed_by: string;
          change_type: string;
          previous_data: Json | null;
          new_data: Json | null;
          changed_at: string;
        };
        Insert: {
          id?: string;
          expense_id: string;
          changed_by: string;
          change_type: string;
          previous_data?: Json | null;
          new_data?: Json | null;
          changed_at?: string;
        };
        Update: Record<string, never>;
      };
      settlements: {
        Row: {
          id: string;
          payer_id: string;
          recipient_id: string;
          amount_paise: number;
          currency: string;
          group_id: string | null;
          status: 'proposed' | 'pending' | 'confirmed' | 'rejected' | 'disputed' | 'cancelled';
          payment_method: string | null;
          upi_ref: string | null;
          notes: string | null;
          idempotency_key: string | null;
          proposed_at: string;
          confirmed_at: string | null;
          rejected_at: string | null;
          cancelled_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          payer_id: string;
          recipient_id: string;
          amount_paise: number;
          currency?: string;
          group_id?: string | null;
          status?: 'proposed' | 'pending' | 'confirmed' | 'rejected' | 'disputed' | 'cancelled';
          payment_method?: string | null;
          upi_ref?: string | null;
          notes?: string | null;
          idempotency_key?: string | null;
        };
        Update: {
          status?: 'proposed' | 'pending' | 'confirmed' | 'rejected' | 'disputed' | 'cancelled';
          upi_ref?: string | null;
          notes?: string | null;
          confirmed_at?: string | null;
          rejected_at?: string | null;
          cancelled_at?: string | null;
          updated_at?: string;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: 'friend_request' | 'friend_accepted' | 'expense_added' | 'expense_updated' | 'expense_deleted' | 'settlement_proposed' | 'settlement_confirmed' | 'settlement_rejected' | 'group_invitation' | 'group_member_added' | 'group_member_removed' | 'debt_reminder' | 'balance_summary';
          title: string;
          body: string;
          data: Json | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: 'friend_request' | 'friend_accepted' | 'expense_added' | 'expense_updated' | 'expense_deleted' | 'settlement_proposed' | 'settlement_confirmed' | 'settlement_rejected' | 'group_invitation' | 'group_member_added' | 'group_member_removed' | 'debt_reminder' | 'balance_summary';
          title: string;
          body: string;
          data?: Json | null;
          read_at?: string | null;
        };
        Update: {
          read_at?: string | null;
        };
      };
      notification_preferences: {
        Row: {
          user_id: string;
          push_enabled: boolean;
          email_enabled: boolean;
          expense_notifications: boolean;
          settlement_notifications: boolean;
          friend_notifications: boolean;
          reminder_enabled: boolean;
          reminder_day: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          push_enabled?: boolean;
          email_enabled?: boolean;
          expense_notifications?: boolean;
          settlement_notifications?: boolean;
          friend_notifications?: boolean;
          reminder_enabled?: boolean;
          reminder_day?: number;
        };
        Update: {
          push_enabled?: boolean;
          email_enabled?: boolean;
          expense_notifications?: boolean;
          settlement_notifications?: boolean;
          friend_notifications?: boolean;
          reminder_enabled?: boolean;
          reminder_day?: number;
          updated_at?: string;
        };
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          last_used_at?: string | null;
        };
        Update: {
          last_used_at?: string | null;
        };
      };
      idempotency_records: {
        Row: {
          key: string;
          user_id: string;
          operation: string;
          result_id: string | null;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          key: string;
          user_id: string;
          operation: string;
          result_id?: string | null;
          expires_at?: string;
        };
        Update: {
          result_id?: string | null;
        };
      };
      activity_log: {
        Row: {
          id: string;
          user_id: string;
          actor_id: string | null;
          entity_type: string;
          entity_id: string | null;
          action: string;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          actor_id?: string | null;
          entity_type: string;
          entity_id?: string | null;
          action: string;
          metadata?: Json | null;
        };
        Update: Record<string, never>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      are_friends: {
        Args: { user_a: string; user_b: string };
        Returns: boolean;
      };
      is_group_member: {
        Args: { p_user_id: string; p_group_id: string };
        Returns: boolean;
      };
      is_group_admin: {
        Args: { p_user_id: string; p_group_id: string };
        Returns: boolean;
      };
      can_access_expense: {
        Args: { p_user_id: string; p_expense_id: string };
        Returns: boolean;
      };
      accept_invitation: {
        Args: { p_token: string };
        Returns: { success?: boolean; error?: string; type?: string; friendId?: string; groupId?: string };
      };
      get_invitation_preview: {
        Args: { p_token: string };
        Returns: Json;
      };
      get_friend_balances: {
        Args: Record<string, never>;
        Returns: { other_user_id: string; net_paise: number; owed_to_paise: number; owing_paise: number }[];
      };
      propose_settlement: {
        Args: { p_recipient_id: string; p_amount_paise: number; p_idempotency_key: string };
        Returns: string;
      };
      respond_to_settlement: {
        Args: { p_settlement_id: string; p_action: string };
        Returns: string;
      };
      cancel_settlement: {
        Args: { p_settlement_id: string };
        Returns: string;
      };
    };
    Enums: {
      friendship_status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'blocked';
      invitation_type: 'friend' | 'group';
      group_type: 'trip' | 'household' | 'event' | 'custom';
      member_role: 'admin' | 'member';
      split_method: 'equal' | 'unequal' | 'percentage' | 'shares' | 'itemized' | 'manual';
      expense_status: 'active' | 'voided' | 'deleted';
      settlement_status: 'proposed' | 'pending' | 'confirmed' | 'rejected' | 'disputed' | 'cancelled';
      notification_type: 'friend_request' | 'friend_accepted' | 'expense_added' | 'expense_updated' | 'expense_deleted' | 'settlement_proposed' | 'settlement_confirmed' | 'settlement_rejected' | 'group_invitation' | 'group_member_added' | 'group_member_removed' | 'debt_reminder' | 'balance_summary';
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T];
