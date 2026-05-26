module TigerEx
  module Gateway
    class PaymentGateway
      def initialize(config)
        @config = config
        @processors = {}
      end
      
      def register_processor(name, processor)
        @processors[name] = processor
      end
      
      def process_payment(payment)
        processor = @processors[payment[:processor]]
        return { error: "No processor" } unless processor
        
        processor.call(payment)
      end
      
      def refund(payment_id, amount)
        { status: "refunded", payment_id: payment_id, amount: amount }
      end
      
      def get_balance
        { balance: 1000000.00, currency: "USD" }
      end
    end
  end
end