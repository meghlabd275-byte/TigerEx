module TigerEx
  module Risk
    class Evaluator
      def initialize(limits)
        @limits = limits
      end
      
      def evaluate(user_id, amount)
        if amount > @limits[user_id][:daily]
          return { approved: false, reason: "Daily limit exceeded" }
        end
        
        { approved: true }
      end
      
      def check_position(user_id, positions)
        total = positions.sum { |p| p[:value] }
        if total > @limits[user_id][:position]
          return { approved: false, reason: "Position limit exceeded" }
        end
        { approved: true }
      end
    end
  end
end