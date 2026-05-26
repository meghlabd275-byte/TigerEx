module TigerEx
  module Matching
    class Router
      def initialize
        @routes = {}
      end
      
      def add_route(path, handler)
        @routes[path] = handler
      end
      
      def route(request)
        path = request[:path]
        handler = @routes[path]
        
        if handler.nil?
          return { status: 404, body: "Not Found" }
        end
        
        handler.call(request)
      end
      
      def list_routes
        @routes.keys
      end
    end
  end
end