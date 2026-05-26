# frozen_string_literal: true

# TigerEx Admin Panel - Ruby on Rails Models
# Internal admin operations and user management

module TigerEx
  module Admin
    # ============================================================================
    # USER MODEL
    # ============================================================================
    
    class User < ApplicationRecord
      self.table_name = 'admin_users'
      
      # Associations
      has_many :audit_logs, dependent: :destroy
      has_many :permissions, dependent: :destroy
      
      # Validations
      validates :email, presence: true, uniqueness: true
      validates :username, presence: true, uniqueness: true
      validates :role, inclusion: { in: %w[super_admin admin moderator support] }
      
      # Scopes
      scope :active, -> { where(active: true) }
      scope :admins, -> { where(role: 'admin') }
      scope :recent, -> { order(created_at: :desc) }
      
      # Roles
      def super_admin?
        role == 'super_admin'
      end
      
      def admin?
        %w[super_admin admin].include?(role)
      end
      
      # Permissions
      def can?(permission)
        return true if super_admin?
        permissions.exists?(action: permission)
      end
    end
    
    # ============================================================================
    # AUDIT LOG MODEL
    # ============================================================================
    
    class AuditLog < ApplicationRecord
      self.table_name = 'admin_audit_logs'
      
      # Associations
      belongs_to :user, class_name: 'User'
      
      # Scopes
      scope :by_user, ->(user_id) { where(user_id: user_id) }
      scope :by_action, ->(action) { where(action: action) }
      scope :recent, -> { order(created_at: :desc) }
      scope :date_range, ->(start_date, end_date) { 
        where(created_at: start_date..end_date) 
      }
      
      # Log action
      def self.log(user_id, action, details = {})
        create!(
          user_id: user_id,
          action: action,
          details: details.to_json,
          ip_address: Thread.current[:request_ip]
        )
      end
    end
    
    # ============================================================================
    # PERMISSION MODEL
    # ============================================================================
    
    class Permission < ApplicationRecord
      self.table_name = 'admin_permissions'
      
      belongs_to :user, class_name: 'User'
      
      validates :action, presence: true
      
      # Permission categories
      PERMISSION_CATEGORIES = {
        'users' => %w[read create update delete suspend],
        'kyc' => %w[read approve reject],
        'trades' => %w[read cancel refund],
        'wallets' => %w[read freeze unfreeze],
        'settings' => %w[read update],
        'reports' => %w[read export],
        'super_admin' => %w[all]
      }.freeze
    end
    
    # ============================================================================
    # TICKET MODEL
    # ============================================================================
    
    class SupportTicket < ApplicationRecord
      self.table_name = 'support_tickets'
      
      enum status: { open: 0, in_progress: 1, resolved: 2, closed: 3 }
      enum priority: { low: 0, medium: 1, high: 2, urgent: 3 }
      
      belongs_to :user
      belongs_to :assigned_to, class_name: 'User', optional: true
      
      validates :subject, presence: true
      validates :description, presence: true
      
      scope :unassigned, -> { where(assigned_to_id: nil) }
      scope :open_tickets, -> { where(status: :open) }
      
      # Assign ticket
      def assign_to(admin_user_id)
        update(assigned_to_id: admin_user_id, status: :in_progress)
      end
      
      # Resolve ticket
      def resolve
        update(status: :resolved)
      end
    end
    
    # ============================================================================
    # REPORTING SERVICE
    # ============================================================================
    
    class ReportingService
      def initialize(start_date, end_date)
        @start_date = start_date
        @end_date = end_date
      end
      
      def user_stats
        {
          total_users: User.count,
          new_users: User.where('created_at BETWEEN ? AND ?', 
                              @start_date, @end_date).count,
          active_users: User.active.count,
          suspended: User.where(active: false).count
        }
      end
      
      def trading_stats
        {
          total_trades: Trade.count,
          volume: Trade.where('created_at BETWEEN ? AND ?', 
                           @start_date, @end_date).sum(:volume),
          fees_collected: Trade.where('created_at BETWEEN ? AND ?', 
                                    @start_date, @end_date).sum(:fee)
        }
      end
      
      def kyc_stats
        {
          pending: KycApplication.where(status: :pending).count,
          approved: KycApplication.where(status: :approved).count,
          rejected: KycApplication.where(status: :rejected).count
        }
      end
      
      def generate_report
        {
          period: "#{@start_date} - #{end_date}",
          generated_at: Time.current,
          users: user_stats,
          trading: trading_stats,
          kyc: kyc_stats
        }
      end
    end
  end
end

# Example usage:
#
# # Create admin user
# admin = TigerEx::Admin::User.create!(
#   email: 'admin@tigerex.com',
#   username: 'admin',
#   role: 'admin'
# )
#
# # Log action
# TigerEx::Admin::AuditLog.log(admin.id, 'user_suspend', { user_id: 123 })
#
# # Get reports
# reporter = TigerEx::Admin::ReportingService.new(1.month.ago, Time.current)
# puts reporter.generate_report