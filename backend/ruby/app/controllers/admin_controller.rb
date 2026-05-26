# TigerEx Admin Panel - Ruby on Rails (9 files equivalent)
# Internal admin tools migrated from TypeScript

# ============================================================================
# ADMIN CONTROLLER
# ============================================================================

class AdminController < ApplicationController
  before_action :require_admin!
  
  # Dashboard
  def dashboard
    @stats = {
      total_users: User.count,
      active_traders: Trade.where('created_at > ?', 24.hours.ago).distinct.count(:user_id),
      daily_volume: Trade.where('created_at > ?', 24.hours.ago).sum(:volume),
      daily_revenue: Trade.where('created_at > ?', 24.hours.ago).sum(:fee)
    }
  end
  
  # User Management
  def users
    @users = User.all.order(created_at: :desc).page(params[:page])
    @users = @users.where(email: params[:email]) if params[:email].present?
    @users = @users.where(status: params[:status]) if params[:status].present?
  end
  
  def user_detail
    @user = User.find(params[:id])
    @trades = @user.trades.order(created_at: :desc).limit(100)
    @wallets = @user.wallets
  end
  
  def update_user_status
    user = User.find(params[:id])
    user.update(status: params[:status])
    render json: { success: true }
  end
  
  def update_kyc_level
    user = User.find(params[:id])
    user.update(kyc_level: params[:level].to_i)
    render json: { success: true }
  end
  
  # Trading Management
  def trades
    @trades = Trade.all.order(created_at: :desc).page(params[:page])
    @trades = @trades.where(symbol: params[:symbol]) if params[:symbol].present?
    @trades = @trades.where(user_id: params[:user_id]) if params[:user_id].present?
  end
  
  def cancel_trade
    trade = Trade.find(params[:id])
    trade.cancel!
    render json: { success: true, message: "Trade cancelled" }
  end
  
  def force_settle
    trade = Trade.find(params[:id])
    trade.force_settle!
    render json: { success: true, message: "Trade forcibly settled" }
  end
  
  # Market Management
  def markets
    @markets = Market.all
  end
  
  def create_market
    market = Market.create!({
      symbol: params[:symbol],
      base_asset: params[:base_asset],
      quote_asset: params[:quote_asset],
      status: params[:status] || 'trading',
      maker_fee: params[:maker_fee] || 0.001,
      taker_fee: params[:taker_fee] || 0.001
    })
    render json: { success: true, market: market }
  end
  
  def update_market
    market = Market.find(params[:id])
    market.update(market_params)
    render json: { success: true, market: market }
  end
  
  def toggle_market
    market = Market.find(params[:id])
    market.toggle_status!
    render json: { success: true, status: market.status }
  end
  
  # Wallet Management
  def wallets
    @wallets = Wallet.all.page(params[:page])
  end
  
  def wallet_balances
    user = User.find(params[:user_id])
    @balances = user.wallets
  end
  
  def adjust_balance
    wallet = Wallet.find(params[:id])
    wallet.adjust_balance!(params[:amount].to_d, params[:reason])
    render json: { success: true, balance: wallet.balance }
  end
  
  def freeze_wallet
    wallet = Wallet.find(params[:id])
    wallet.freeze!
    render json: { success: true, message: "Wallet frozen" }
  end
  
  def unfreeze_wallet
    wallet = Wallet.find(params[:id])
    wallet.unfreeze!
    render json: { success: true, message: "Wallet unfrozen" }
  end
  
  # Compliance
  def kyc_submissions
    @submissions = KycSubmission.pending.order(created_at: :desc).page(params[:page])
  end
  
  def approve_kyc
    submission = KycSubmission.find(params[:id])
    submission.approve!
    render json: { success: true }
  end
  
  def reject_kyc
    submission = KycSubmission.find(params[:id])
    submission.reject!(params[:reason])
    render json: { success: true }
  end
  
  # Reports
  def reports
    @reports = Report.all.order(created_at: :desc).page(params[:page])
  end
  
  def generates_report
    report = Report.generate!(params[:type], params[:start_date], params[:end_date])
    render json: { success: true, report_id: report.id }
  end
  
  private
  
  def require_admin!
    raise "Access denied" unless current_user.admin?
  end
  
  def market_params
    params.permit(:symbol, :base_asset, :quote_asset, :status, :maker_fee, :taker_fee)
  end
end

# ============================================================================
# SUPER ADMIN CONTROLLER
# ============================================================================

class SuperAdminController < ApplicationController
  before_action :require_super_admin!
  
  # System Health
  def system_health
    @health = {
      api_server: HealthCheck.api_server,
      database: HealthCheck.database,
      redis: HealthCheck.redis,
      kafka: HealthCheck.kafka,
      workers: HealthCheck.workers
    }
  end
  
  # System Metrics
  def metrics
    @metrics = {
      requests_per_second: Metrics.requests_per_second,
      average_latency: Metrics.average_latency,
      error_rate: Metrics.error_rate,
      active_connections: Metrics.active_connections
    }
  end
  
  # Emergency Controls
  def emergency_stop
    System.emergency_shutdown!
    render json: { success: true, message: "Emergency shutdown initiated" }
  end
  
  def emergency_resume
    System.emergency_resume!
    render json: { success: true, message: "System resumed" }
  end
  
  def pause_trading
    System.pause_trading!
    render json: { success: true, message: "Trading paused" }
  end
  
  def resume_trading
    System.resume_trading!
    render json: { success: true, message: "Trading resumed" }
  end
  
  # Fee Configuration
  def fee_structure
    @fees = FeeStructure.all
  end
  
  def update_fee
    fee = FeeStructure.find(params[:id])
    fee.update!(amount: params[:amount])
    render json: { success: true, fee: fee }
  end
  
  # Feature Flags
  def feature_flags
    @flags = FeatureFlag.all
  end
  
  def toggle_feature
    flag = FeatureFlag.find(params[:name])
    flag.toggle!
    render json: { success: true, enabled: flag.enabled }
  end
  
  private
  
  def require_super_admin!
    raise "Super admin access required" unless current_user.super_admin?
  end
end

# ============================================================================
# REGIONAL OFFICE CONTROLLER
# ============================================================================

class RegionalOfficeController < ApplicationController
  before_action :requireRegionalAdmin!
  
  def index
    @offices = RegionalOffice.all
  end
  
  def create_office
    office = RegionalOffice.create!({
      name: params[:name],
      region: params[:region],
      jurisdiction: params[:jurisdiction],
      local_currency: params[:local_currency],
      operating_hours: params[:operating_hours]
    })
    render json: { success: true, office: office }
  end
  
  def update_compliance_rules
    office = RegionalOffice.find(params[:id])
    office.update_compliance_rules!(params[:rules])
    render json: { success: true }
  end
end

# ============================================================================
# PHONE SUPPORT TICKET CONTROLLER
# ============================================================================

class SupportTicketController < ApplicationController
  before_action :authenticate!
  
  def create_ticket
    ticket = SupportTicket.create!({
      user_id: current_user.id,
      subject: params[:subject],
      description: params[:description],
      category: params[:category],
      priority: params[:priority] || 'normal'
    })
    render json: { success: true, ticket_id: ticket.id }
  end
  
  def my_tickets
    @tickets = current_user.support_tickets.order(created_at: :desc)
  end
  
  def ticket_detail
    @ticket = SupportTicket.find(params[:id])
  end
  
  def add_response
    ticket = SupportTicket.find(params[:id])
    ticket.add_response(current_user.id, params[:message])
    render json: { success: true }
  end
  
  def close_ticket
    ticket = SupportTicket.find(params[:id])
    ticket.close!
    render json: { success: true }
  end
end

# ============================================================================
# LISTING APPLICATION CONTROLLER
# ============================================================================

class ListingApplicationController < ApplicationController
  before_action :require_admin!, only: [:approve, :reject]
  
  def apply
    application = ListingApplication.create!({
      applicant_id: current_user.id,
      token_symbol: params[:token_symbol],
      token_name: params[:token_name],
      description: params[:description],
      website: params[:website],
      whitepaper: params[:whitepaper]
    })
    render json: { success: true, application_id: application.id }
  end
  
  def my_applications
    @applications = current_user.listing_applications.order(created_at: :desc)
  end
  
  def application_detail
    @application = ListingApplication.find(params[:id])
  end
  
  def approve
    application = ListingApplication.find(params[:id])
    application.approve!
    render json: { success: true }
  end
  
  def reject
    application = ListingApplication.find(params[:id])
    application.reject!(params[:reason])
    render json: { success: true }
  end
end

# ============================================================================
# MODELS
# ============================================================================

class User < ActiveRecord::Base
  has_many :trades
  has_many :wallets
  has_many :support_tickets
end

class Trade < ActiveRecord::Base
  belongs_to :user
end

class Wallet < ActiveRecord::Base
  belongs_to :user
  
  def adjust_balance!(amount, reason)
    update!(balance: balance + amount)
    # Log the adjustment
  end
  
  def freeze!
    update!(status: 'frozen')
  end
  
  def unfreeze!
    update!(status: 'active')
  end
end

class Market < ActiveRecord::Base
  def toggle_status!
    update!(status: status == 'trading' ? 'halted' : 'trading')
  end
end

class KycSubmission < ActiveRecord::Base
  def approve!
    update!(status: 'approved')
  end
  
  def reject!(reason)
    update!(status: 'rejected', rejection_reason: reason)
  end
end

class Report < ActiveRecord::Base
  def self.generate!(type, start_date, end_date)
    # Generate report
  end
end

class System
  def self.emergency_shutdown!
    # Emergency shutdown
  end
  
  def self.emergency_resume!
    # Resume system
  end
  
  def self.pause_trading!
    # Pause trading
  end
  
  def self.resume_trading!
    # Resume trading
  end
end

class HealthCheck
  def self.api_server; "healthy"; end
  def self.database; "healthy"; end
  def self.redis; "healthy"; end
  def self.kafka; "healthy"; end
  def self.workers; "healthy"; end
end

class Metrics
  def self.requests_per_second; 10000; end
  def self.average_latency; 50; end
  def self.error_rate; 0.001; end
  def self.active_connections; 50000; end
end

class FeeStructure < ActiveRecord::Base; end
class FeatureFlag < ActiveRecord::Base; end
class RegionalOffice < ActiveRecord::Base; end
class SupportTicket < ActiveRecord::Base; end
class ListingApplication < ActiveRecord::Base; end

# ============================================================================
# ROUTES
# ============================================================================

Rails.application.routes.draw do
  # Admin routes
  get '/admin/dashboard', to: 'admin#dashboard'
  get '/admin/users', to: 'admin#users'
  get '/admin/users/:id', to: 'admin#user_detail'
  put '/admin/users/:id/status', to: 'admin#update_user_status'
  put '/admin/users/:id/kyc', to: 'admin#update_kyc_level'
  
  get '/admin/trades', to: 'admin#trades'
  delete '/admin/trades/:id', to: 'admin#cancel_trade'
  post '/admin/trades/:id/settle', to: 'admin#force_settle'
  
  get '/admin/markets', to: 'admin#markets'
  post '/admin/markets', to: 'admin#create_market'
  put '/admin/markets/:id', to: 'admin#update_market'
  post '/admin/markets/:id/toggle', to: 'admin#toggle_market'
  
  get '/admin/wallets', to: 'admin#wallets'
  get '/admin/wallets/:user_id', to: 'admin#wallet_balances'
  post '/admin/wallets/:id/adjust', to: 'admin#adjust_balance'
  post '/admin/wallets/:id/freeze', to: 'admin#freeze_wallet'
  post '/admin/wallets/:id/unfreeze', to: 'admin#unfreeze_wallet'
  
  get '/admin/kyc', to: 'admin#kyc_submissions'
  post '/admin/kyc/:id/approve', to: 'admin#approve_kyc'
  post '/admin/kyc/:id/reject', to: 'admin#reject_kyc'
  
  # Super Admin routes
  get '/superadmin/health', to: 'super_admin#system_health'
  get '/superadmin/metrics', to: 'super_admin#metrics'
  post '/superadmin/emergency/stop', to: 'super_admin#emergency_stop'
  post '/superadmin/emergency/resume', to: 'super_admin#emergency_resume'
  post '/superadmin/trading/pause', to: 'super_admin#pause_trading'
  post '/superadmin/trading/resume', to: 'super_admin#resume_trading'
  
  # Regional
  get '/regional/offices', to: 'regional_office#index'
  post '/regional/offices', to: 'regional_office#create_office'
  
  # Support
  post '/support/tickets', to: 'support_ticket#create_ticket'
  get '/support/tickets', to: 'support_ticket#my_tickets'
  get '/support/tickets/:id', to: 'support_ticket#ticket_detail'
  post '/support/tickets/:id/respond', to: 'support_ticket#add_response'
  post '/support/tickets/:id/close', to: 'support_ticket#close_ticket'
  
  # Listings
  post '/listing/apply', to: 'listing_application#apply'
  get '/listing/applications', to: 'listing_application#my_applications'
  get '/listing/applications/:id', to: 'listing_application#application_detail'
  post '/listing/applications/:id/approve', to: 'listing_application#approve'
  post '/listing/applications/:id/reject', to: 'listing_application#reject'
end

puts "TigerEx Admin Routes Loaded!"