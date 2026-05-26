#!/usr/bin/env ruby
# Super Admin & RBAC System
# Migration from TypeScript to Ruby/Rails

require 'securerandom'

module SuperAdminAndRBAC
  # Admin
  Admin = Struct.new(:id, :username, :email, :role, :created_at, :last_login)
  
  # Role
  Role = Struct.new(:name, :permissions, :description)
  
  # Audit entry
  AuditEntry = Struct.new(:action, :target, :permission, :timestamp, :details)
  
  # Admin input
  AdminInput = Struct.new(:username, :email, :role)
  
  # Permission
  PERMISSIONS = {
    'users.read' => 1,
    'users.write' => 2,
    'users.delete' => 3,
    'trading.read' => 4,
    'trading.write' => 5,
    'withdrawals.approve' => 6,
    'withdrawals.reject' => 7,
    'kyc.approve' => 8,
    'kyc.reject' => 9,
    'admin.manage' => 10,
    'config.write' => 11
  }.freeze
  
  # Super Admin System
  class SuperAdminSystem
    attr_reader :admins, :audit_log
    
    def initialize
      @admins = {}
      @audit_log = []
      @counter = 0
    end
    
    def create_admin(input)
      @counter += 1
      admin = Admin.new(
        "admin_#{@counter}",
        input[:username],
        input[:email],
        input[:role] || 'super_admin',
        Time.now,
        nil
      )
      @admins[admin.id] = admin
      admin
    end
    
    def grant_permission(admin_id, permission)
      @audit_log << AuditEntry.new('grant_permission', admin_id, permission, Time.now, nil)
      log_action('grant', admin_id, permission)
    end
    
    def revoke_permission(admin_id, permission)
      @audit_log << AuditEntry.new('revoke_permission', admin_id, permission, Time.now, nil)
      log_action('revoke', admin_id, permission)
    end
    
    def get_all_admins
      @admins.values
    end
    
    def get_audit_log(filters = {})
      @audit_log.select do |entry|
        result = true
        result = false if filters[:action] && entry.action != filters[:action]
        result
      end
    end
    
    private
    
    def log_action(action, target, permission)
      puts "[AUDIT] #{action.upcase}: #{target} -> #{permission}"
    end
  end
  
  # RBAC System
  class RBACSystem
    attr_reader :roles, :user_roles
    
    def initialize
      @roles = {}
      @user_roles = {} # user_id => [role_names]
    end
    
    def create_role(name, permissions, description = '')
      role = Role.new(name, permissions, description)
      @roles[name] = role
      role
    end
    
    def assign_role(user_id, role_name)
      @user_roles[user_id] ||= []
      @user_roles[user_id] << role_name unless @user_roles[user_id].include?(role_name)
    end
    
    def remove_role(user_id, role_name)
      @user_roles[user_id]&.delete(role_name)
    end
    
    def has_permission(user_id, permission)
      roles = @user_roles[user_id] || []
      roles.any? do |role_name|
        role = @roles[role_name]
        role&.permissions&.include?(permission)
      end
    end
    
    def get_user_roles(user_id)
      @user_roles[user_id] || []
    end
  end
  
  # Platform Config
  class PlatformConfig
    attr_reader :configs
    
    def initialize
      @configs = {
        'trading_enabled' => 'true',
        'withdrawal_enabled' => 'true',
        'max_leverage' => '20',
        'maintenance_mode' => 'false'
      }
    end
    
    def get(key)
      @configs[key]
    end
    
    def set(key, value)
      @configs[key] = value.to_s
    end
    
    def get_all
      @configs.dup
    end
  end
  
  # Main demo
  def self.demo
    # Super admin
    puts "=== Super Admin ==="
    admin_sys = SuperAdminSystem.new
    
    input = { username: 'admin1', email: 'admin@tigerex.com', role: 'super_admin' }
    admin = admin_sys.create_admin(input)
    puts "Created admin: #{admin.username}"
    
    admin_sys.grant_permission(admin.id, 'users.write')
    puts "Granted permission"
    
    # RBAC
    puts "\n=== RBAC ==="
    rbac = RBACSystem.new
    
    role = rbac.create_role('trader', ['trading.read', 'trading.write'], 'Can trade')
    puts "Created role: #{role.name}"
    
    rbac.assign_role('user1', 'trader')
    puts "Assigned role"
    
    can_trade = rbac.has_permission('user1', 'trading.write')
    puts "Has permission: #{can_trade}"
    
    # Config
    puts "\n=== Config ==="
    config = PlatformConfig.new
    trading = config.get('trading_enabled')
    puts "Trading enabled: #{trading}"
  end
end

# Run demo
SuperAdminAndRBAC.demo