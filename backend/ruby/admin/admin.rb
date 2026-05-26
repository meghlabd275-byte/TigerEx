#!/usr/bin/env ruby
# TigerEx Admin Panel

require 'sinatra'

set :port, 3000

users = {}

get '/admin/users' do
  users.keys.join(', ')
end

post '/admin/user/:id/disable' do
  id = params[:id]
  users[id] = :disabled
  "User #{id} disabled"
end

get '/admin/stats' do
  {total: users.size}.to_json
end

puts "Admin panel running on :3000"