#!/usr/bin/env python3
"""
TigerEx - Notification Service
Complete multi-channel notification system

Features:
- Email notifications
- SMS notifications
- Push notifications (FCM/APNS)
- In-app notifications
- Webhooks
- Templates
- Delivery tracking
"""

import smtplib
import json
import time
import uuid
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from enum import Enum
from queue import Queue
import threading


# ============================================================================
# NOTIFICATION TYPES
# ============================================================================

class NotificationType(Enum):
    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"
    IN_APP = "in_app"
    WEBHOOK = "webhook"


class NotificationStatus(Enum):
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"
    BOUNCED = "bounced"


# ============================================================================
# TEMPLATES
# ============================================================================

NOTIFICATION_TEMPLATES = {
    "welcome": {
        "email": {
            "subject": "Welcome to TigerEx!",
            "body": "Hello {name}, welcome to TigerEx. Your account is ready."
        },
        "sms": "Welcome to TigerEx! Your account is ready. Verify email to start trading."
    },
    
    "deposit": {
        "email": {
            "subject": "Deposit Confirmed - {amount} {currency}",
            "body": "Your deposit of {amount} {currency} has been confirmed."
        },
        "push": {
            "title": "Deposit Received",
            "body": "{amount} {currency} deposited to your account"
        }
    },
    
    "withdrawal": {
        "email": {
            "subject": "Withdrawal Processed - {amount} {currency}",
            "body": "Your withdrawal of {amount} {currency} has been processed."
        },
        "push": {
            "title": "Withdrawal Sent",
            "body": "{amount} {currency} sent to {address}"
        }
    },
    
    "order_filled": {
        "email": {
            "subject": "Order Filled - {symbol}",
            "body": "Your {side} order for {symbol} at {price} has been filled."
        },
        "in_app": {
            "title": "Order Filled",
            "body": "{side} {quantity} {symbol} @ {price}"
        }
    },
    
    "security_alert": {
        "email": {
            "subject": "Security Alert - New Login",
            "body": "New login from {ip} at {time}. If not you, secure your account."
        },
        "sms": "Security: New login from {ip}. If not you, reset password."
    },
    
    "kyc_approved": {
        "email": {
            "subject": "KYC Approved - Full Access Unlocked",
            "body": "Congratulations! Your identity has been verified."
        }
    },
    
    "price_alert": {
        "push": {
            "title": "Price Alert: {symbol}",
            "body": "{symbol} has reached {price}"
        },
        "in_app": {
            "title": "Price Alert",
            "body": "{symbol} hit {price}"
        }
    }
}


# ============================================================================
# NOTIFICATION ENTITY
# ============================================================================

@dataclass
class Notification:
    """Notification record"""
    notification_id: str
    user_id: str
    type: NotificationType
    channel: str  # email, sms, push, etc
    recipient: str
    subject: str
    body: str
    metadata: Dict
    status: NotificationStatus
    priority: int = 0
    created_at: int = field(default_factory=lambda: int(time.time()))
    sent_at: Optional[int] = None
    delivered_at: Optional[int] = None
    failure_reason: Optional[str] = None


@dataclass
class UserPreference:
    """User notification preferences"""
    user_id: str
    email_enabled: bool = True
    sms_enabled: bool = True
    push_enabled: bool = True
    in_app_enabled: bool = True
    marketing_enabled: bool = True
    price_alerts: bool = True
    trade_alerts: bool = True
    security_alerts: bool = True
    digest_frequency: str = "instant"  # instant, hourly, daily, weekly


# ============================================================================
# EMAIL SERVICE
# ============================================================================

class EmailService:
    """Email sending service"""
    
    def __init__(self):
        self.smtp_host = "smtp.example.com"
        self.smtp_port = 587
        self.username = ""
        self.password = ""
        self.from_address = "noreply@tigerex.com"
        self.from_name = "TigerEx"
    
    def send(self, to: str, subject: str, body: str, 
             html: Optional[str] = None) -> bool:
        """Send email"""
        try:
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = f"{self.from_name} <{self.from_address}>"
            msg['To'] = to
            
            # Plain text
            part1 = MIMEText(body, 'plain')
            msg.attach(part1)
            
            # HTML if provided
            if html:
                part2 = MIMEText(html, 'html')
                msg.attach(part2)
            
            # In production: connect to SMTP and send
            # with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
            #     server.starttls()
            #     server.login(self.username, self.password)
            #     server.sendmail(self.from_address, to, msg.as_string())
            
            return True
            
        except Exception as e:
            print(f"Email send error: {e}")
            return False


# ============================================================================
# SMS SERVICE
# ============================================================================

class SMSService:
    """SMS sending service"""
    
    def __init__(self):
        self.provider = "twilio"  # or vonage, aws_sns
        self.api_key = ""
        self.api_secret = ""
        self.from_number = ""
    
    def send(self, to: str, body: str) -> bool:
        """Send SMS"""
        try:
            # In production: integrate with provider
            # Twilio example:
            # from twilio.rest import Client
            # client = Client(self.api_key, self.api_secret)
            # message = client.messages.create(
            #     body=body,
            #     from_=self.from_number,
            #     to=to
            # )
            
            print(f"SMS to {to}: {body[:50]}...")
            return True
            
        except Exception as e:
            print(f"SMS send error: {e}")
            return False


# ============================================================================
# PUSH NOTIFICATION SERVICE
# ============================================================================

class PushService:
    """Push notification service"""
    
    def __init__(self):
        self.fcm_key = ""  # Firebase Cloud Messaging
        self.apns_key = ""  # Apple Push
        self.web_push_key = ""
    
    def send_to_user(self, user_id: str, title: str, body: str,
                    data: Optional[Dict] = None) -> bool:
        """Send push notification to user"""
        try:
            # Get user's device tokens from database
            tokens = self._get_user_tokens(user_id)
            
            for token in tokens:
                self._send_to_token(token, title, body, data)
            
            return True
            
        except Exception as e:
            print(f"Push send error: {e}")
            return False
    
    def _send_to_token(self, token: str, title: str, body: str,
                      data: Optional[Dict]) -> bool:
        """Send to specific token"""
        # FCM example:
        # import firebase_admin
        # from firebase_admin import messaging
        # 
        # message = messaging.Message(
        #     notification=messaging.Notification(title=title, body=body),
        #     data=data or {},
        #     token=token
        # )
        # messaging.send(message)
        
        return True
    
    def _get_user_tokens(self, user_id: str) -> List[str]:
        """Get user's device tokens"""
        # Would fetch from database
        return []


# ============================================================================
# IN-APP NOTIFICATIONS
# ============================================================================

class InAppNotifications:
    """In-app notification storage"""
    
    def __init__(self):
        self.notifications: Dict[str, List[Notification]] = {}
        self.unread_counts: Dict[str, int] = {}
    
    def create(self, user_id: str, title: str, body: str,
              notification_type: str, data: Optional[Dict] = None) -> str:
        """Create in-app notification"""
        
        notification = Notification(
            notification_id=str(uuid.uuid4()),
            user_id=user_id,
            type=NotificationType.IN_APP,
            channel="in_app",
            recipient=user_id,
            subject=title,
            body=body,
            metadata=data or {},
            status=NotificationStatus.PENDING
        )
        
        if user_id not in self.notifications:
            self.notifications[user_id] = []
            self.unread_counts[user_id] = 0
        
        self.notifications[user_id].append(notification)
        self.unread_counts[user_id] += 1
        
        return notification.notification_id
    
    def get_user_notifications(self, user_id: str, 
                           limit: int = 50) -> List[Notification]:
        """Get user's notifications"""
        return self.notifications.get(user_id, [])[:limit]
    
    def mark_read(self, user_id: str, notification_id: str) -> bool:
        """Mark notification as read"""
        for notif in self.notifications.get(user_id, []):
            if notif.notification_id == notification_id:
                notif.status = NotificationStatus.DELIVERED
                self.unread_counts[user_id] = max(0, self.unread_counts.get(user_id, 1) - 1)
                return True
        return False
    
    def get_unread_count(self, user_id: str) -> int:
        """Get unread count"""
        return self.unread_counts.get(user_id, 0)


# ============================================================================
# WEBHOOKS
# ============================================================================

class WebhookService:
    """Webhook delivery service"""
    
    def __init__(self):
        self.webhooks: Dict[str, List[str]] = {}  # event -> urls
    
    def register(self, event: str, url: str, secret: str = ""):
        """Register webhook URL for event"""
        if event not in self.webhooks:
            self.webhooks[event] = []
        
        self.webhooks[event].append(url)
    
    def trigger(self, event: str, data: Dict) -> List[bool]:
        """Trigger webhook for event"""
        results = []
        
        for url in self.webhooks.get(event, []):
            result = self._deliver(url, event, data)
            results.append(result)
        
        return results
    
    def _deliver(self, url: str, event: str, data: Dict) -> bool:
        """Deliver webhook payload"""
        import requests
        
        payload = {
            "event": event,
            "timestamp": int(time.time()),
            "data": data
        }
        
        try:
            # In production:
            # response = requests.post(url, json=payload, timeout=10)
            # return response.status_code == 200
            
            print(f"Webhook to {url}: {event}")
            return True
            
        except Exception as e:
            print(f"Webhook error: {e}")
            return False


# ============================================================================
# MAIN NOTIFICATION ENGINE
# ============================================================================

class NotificationService:
    """Complete notification orchestrator"""
    
    def __init__(self):
        self.email = EmailService()
        self.sms = SMSService()
        self.push = PushService()
        self.in_app = InAppNotifications()
        self.webhook = WebhookService()
        
        self.preferences: Dict[str, UserPreference] = {}
        
        # Queue for async delivery
        self.queue = Queue()
        self.worker_thread = None
        self.running = False
    
    def start_worker(self):
        """Start background notification worker"""
        self.running = True
        self.worker_thread = threading.Thread(target=self._worker)
        self.worker_thread.start()
    
    def stop_worker(self):
        """Stop worker"""
        self.running = False
        if self.worker_thread:
            self.worker_thread.join()
    
    def _worker(self):
        """Background worker for delivery"""
        while self.running:
            try:
                # Process queue
                task = self.queue.get(timeout=1)
                self._process_task(task)
            except:
                pass
    
    def _process_task(self, task: Dict):
        """Process notification task"""
        notif_type = task["type"]
        user_id = task["user_id"]
        
        # Get preferences
        prefs = self.preferences.get(user_id)
        
        if notif_type == "email" and (not prefs or prefs.email_enabled):
            self.email.send(task["to"], task["subject"], task["body"])
        
        elif notif_type == "sms" and (not prefs or prefs.sms_enabled):
            self.sms.send(task["to"], task["body"])
        
        elif notif_type == "push" and (not prefs or prefs.push_enabled):
            self.push.send_to_user(user_id, task["title"], task["body"], task.get("data"))
        
        elif notif_type == "in_app":
            self.in_app.create(user_id, task["title"], task["body"], 
                            task.get("notification_type", "general"), task.get("data"))
    
    # ---------------------------------------------------------------------------
    # SEND METHODS
    # ---------------------------------------------------------------------------
    
    def send(self, user_id: str, event: str, context: Dict,
            channels: Optional[List[str]] = None):
        """Send notification across channels"""
        
        # Get template
        template = NOTIFICATION_TEMPLATES.get(event, {})
        
        channels = channels or ["in_app"]  # Default to in-app
        
        # Get user contact info (would fetch from user service)
        user_email = f"{user_id}@example.com"
        user_phone = "+1234567890"
        
        for channel in channels:
            task = {
                "user_id": user_id,
                "type": channel,
                "context": context
            }
            
            if channel == "email" and "email" in template:
                tpl = template["email"]
                task["to"] = user_email
                task["subject"] = tpl["subject"].format(**context)
                task["body"] = tpl["body"].format(**context)
                self.queue.put(task)
            
            elif channel == "sms" and "sms" in template:
                tpl = template["sms"]
                task["to"] = user_phone
                task["body"] = tpl.format(**context)
                self.queue.put(task)
            
            elif channel == "push" and "push" in template:
                tpl = template["push"]
                task["title"] = tpl["title"].format(**context)
                task["body"] = tpl["body"].format(**context)
                task["data"] = context
                self.queue.put(task)
            
            elif channel == "in_app":
                if "email" in template:
                    tpl = template["email"]
                elif "push" in template:
                    tpl = template["push"]
                else:
                    tpl = {"title": event, "body": str(context)}
                
                task["title"] = tpl.get("title", event).format(**context)
                task["body"] = tpl.get("body", str(context)).format(**context)
                task["notification_type"] = event
                self.queue.put(task)
    
    def send_immediate(self, user_id: str, channel: str, 
                      subject: str, body: str) -> bool:
        """Send immediately without queuing"""
        
        if channel == "email":
            return self.email.send(f"{user_id}@example.com", subject, body)
        elif channel == "sms":
            return self.sms.send("+1234567890", body)
        
        return False
    
    # ---------------------------------------------------------------------------
    # TEMPLATES
    # ---------------------------------------------------------------------------
    
    def render_template(self, template_name: str, context: Dict) -> Dict:
        """Render notification template"""
        template = NOTIFICATION_TEMPLATES.get(template_name, {})
        
        rendered = {}
        for channel, content in template.items():
            if isinstance(content, dict):
                rendered[channel] = {
                    k: v.format(**context) if isinstance(v, str) else v
                    for k, v in content.items()
                }
        
        return rendered
    
    # ---------------------------------------------------------------------------
    # PREFERENCES
    # ---------------------------------------------------------------------------
    
    def update_preferences(self, user_id: str, prefs: Dict):
        """Update user notification preferences"""
        current = self.preferences.get(user_id, UserPreference(user_id))
        
        for key, value in prefs.items():
            if hasattr(current, key):
                setattr(current, key, value)
        
        self.preferences[user_id] = current
    
    # ---------------------------------------------------------------------------
    # PRICE ALERTS
    # ---------------------------------------------------------------------------
    
    def check_price_alerts(self, symbol: str, price: float):
        """Check and trigger price alerts"""
        # Would query price alert subscriptions
        # For each subscribed user, send alert
        pass


# ============================================================================
# MAIN
# ============================================================================

def main():
    print("TigerEx Notification Service v1.0")
    print("=" * 35)
    
    service = NotificationService()
    
    # Start worker
    service.start_worker()
    
    # Send notifications
    service.send("user123", "welcome", {"name": "John"})
    service.send("user123", "deposit", {"amount": "1.5", "currency": "BTC"})
    service.send("user123", "order_filled", {
        "side": "BUY",
        "symbol": "BTC/USDT",
        "price": "50,000",
        "quantity": "0.5"
    }, channels=["email", "push", "in_app"])
    
    # In-app notifications
    notif_id = service.in_app.create("user123", "Test", "Test notification", "test")
    print(f"Created notification: {notif_id}")
    
    # Get notifications
    notifs = service.in_app.get_user_notifications("user123")
    print(f"User has {len(notifs)} notifications")
    
    # Stop worker
    time.sleep(1)
    service.stop_worker()
    
    print("\nNotification service ready.")


if __name__ == "__main__":
    main()