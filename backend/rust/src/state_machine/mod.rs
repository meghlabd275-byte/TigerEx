// State Machine - Workflow State Management
// Rust for reliable workflow orchestrations

use std::collections::HashMap;

// State type
#[derive(Debug, Clone, PartialEq)]
pub enum State {
    Init,
    Pending,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

// Transition event
#[derive(Debug, Clone)]
pub struct Transition {
    pub from: State,
    pub to: State,
    pub event: String,
    pub timestamp: i64,
}

// Valid transitions
#[derive(Debug, Clone)]
pub struct TransitionRule {
    pub from: State,
    pub to: State,
    pub allowed: bool,
}

// State machine definition
#[derive(Debug, Clone)]
pub struct StateMachine {
    pub name: String,
    pub initial: State,
    pub final_states: Vec<State>,
    pub rules: Vec<TransitionRule>,
}

// Instance
#[derive(Debug, Clone)]
pub struct MachineInstance {
    pub id: String,
    pub machine: String,
    pub current: State,
    pub history: Vec<Transition>,
    pub timestamp: i64,
}

impl MachineInstance {
    pub fn new(id: &str, machine: &str, initial: State) -> Self {
        MachineInstance {
            id: id.to_string(),
            machine: machine.to_string(),
            current: initial,
            history: Vec::new(),
            timestamp: now_ms(),
        }
    }

    pub fn transition(&mut self, to: State, event: &str, rule: &TransitionRule) -> Result<(), String> {
        if self.current != rule.from || to != rule.to {
            return Err("invalid transition".to_string());
        }

        if !rule.allowed {
            return Err("transition not allowed".to_string());
        }

        let trans = Transition {
            from: self.current.clone(),
            to: to.clone(),
            event: event.to_string(),
            timestamp: now_ms(),
        };

        self.history.push(trans);
        self.current = to;

        Ok(())
    }

    pub fn can_transition(&self, to: &State) -> bool {
        self.current == *to
    }

    pub fn is_final(&self, final_states: &[State]) -> bool {
        final_states.contains(&self.current)
    }
}

// Factory
pub struct StateMachineFactory {
    machines: HashMap<String, StateMachine>,
    instances: HashMap<String, MachineInstance>,
}

impl StateMachineFactory {
    pub fn new() -> Self {
        StateMachineFactory {
            machines: HashMap::new(),
            instances: HashMap::new(),
        }
    }

    pub fn register(&mut self, machine: StateMachine) {
        self.machines.insert(machine.name.clone(), machine);
    }

    pub fn create_instance(&mut self, machine_name: &str, instance_id: &str) -> Result<MachineInstance, String> {
        let machine = self.machines.get(machine_name)
            .ok_or("machine not found")?;

        let instance = MachineInstance::new(instance_id, machine_name, machine.initial.clone());

        self.instances.insert(instance_id.to_string(), instance.clone());

        Ok(instance)
    }

    pub fn get_instance(&self, instance_id: &str) -> Option<&MachineInstance> {
        self.instances.get(instance_id)
    }

    pub fn process_event(&mut self, instance_id: &str, event: &str, to: State) -> Result<(), String> {
        if let Some(inst) = self.instances.get_mut(instance_id) {
            let machine = self.machines.get(&inst.machine)
                .ok_or("machine not found")?;

            // Find valid transition
            for rule in &machine.rules {
                if inst.current == rule.from && to == rule.to && rule.allowed {
                    return inst.transition(to, event, &rule);
                }
            }
        }

        Err("instance not found".to_string())
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_state_machine() {
        let mut factory = StateMachineFactory::new();

        let machine = StateMachine {
            name: "OrderWorkflow".to_string(),
            initial: State::Init,
            final_states: vec![State::Completed, State::Cancelled],
            rules: vec![
                TransitionRule { from: State::Init, to: State::Pending, allowed: true },
                TransitionRule { from: State::Pending, to: State::Processing, allowed: true },
                TransitionRule { from: State::Processing, to: State::Completed, allowed: true },
            ],
        };

        factory.register(machine);

        let mut inst = factory.create_instance("OrderWorkflow", "order_123").unwrap();
        
        inst.transition(State::Pending, "submit", &TransitionRule {
            from: State::Init,
            to: State::Pending,
            allowed: true,
        }).unwrap();

        assert_eq!(inst.current, State::Pending);
    }
}