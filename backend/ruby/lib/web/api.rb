require 'sinatra'

module TigerEx
  module Web
    class API < Sinatra::Base
      get '/health' do
        content_type :json
        { status: 'ok', uptime: Uptime.now }.to_json
      end
      
      get '/api/v1/markets' do
        content_type :json
        { markets: [] }.to_json
      end
      
      post '/api/v1/orders' do
        content_type :json
        { order_id: '12345', status: 'accepted' }.to_json
      end
      
      get '/api/v1/orders/:id' do
        content_type :json
        { order_id: params[:id], status: 'filled' }.to_json
      end
      
      delete '/api/v1/orders/:id' do
        content_type :json
        { order_id: params[:id], status: 'cancelled' }.to_json
      end
      
      get '/api/v1/user/balance' do
        content_type :json
        { BTC: '1.5', USD: '50000' }.to_json
      end
      
      post '/api/v1/deposit' do
        content_type :json
        { tx_hash: 'abc123', status: 'confirmed' }.to_json
      end
      
      post '/api/v1/withdraw' do
        content_type :json
        { tx_hash: 'def456', status: 'pending' }.to_json
      end
    end
  end
end