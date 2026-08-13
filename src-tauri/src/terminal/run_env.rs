use std::collections::HashMap;

use serde::Serialize;

use super::types::TerminalPortInfo;
use crate::projects::types::PortEntry;

#[derive(Debug, Clone, Default)]
pub struct RunEnvironmentFilter {
    pub worktree_id: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LiveCommandTerminal {
    pub terminal_id: String,
    pub worktree_path: String,
    pub command: String,
    pub command_args: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
pub struct WorktreeRef {
    pub id: String,
    pub name: String,
    pub path: String,
    pub project_id: String,
    pub is_base: bool,
}

#[derive(Debug, Clone)]
pub struct ProjectRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunEnvironmentPort {
    pub port: u16,
    pub process_name: Option<String>,
    pub local_address: Option<String>,
    pub url: String,
    pub source: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunEnvironment {
    pub running: bool,
    pub terminal_id: String,
    pub worktree_id: Option<String>,
    pub worktree_name: Option<String>,
    pub worktree_path: String,
    pub is_base_session: bool,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub session_id: Option<String>,
    pub command: String,
    pub command_args: Option<Vec<String>>,
    pub ports: Vec<RunEnvironmentPort>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunEnvironmentsResult {
    pub environments: Vec<RunEnvironment>,
}

fn normalize_path(path: &str) -> String {
    path.trim_end_matches(['/', '\\']).to_string()
}

fn url_from_host_and_port(host: &str, port: u16) -> String {
    let host = match host.trim_matches(['[', ']']) {
        "*" | "0.0.0.0" | "::" | "::0" => "127.0.0.1".to_string(),
        host => host.to_string(),
    };
    if host.contains(':') {
        format!("http://[{host}]:{port}")
    } else {
        format!("http://{host}:{port}")
    }
}

fn url_from_listen_address(address: &str, port: u16) -> String {
    let host = if let Some(rest) = address.strip_prefix('[') {
        rest.split_once(']')
            .map(|(host, _)| host)
            .unwrap_or(address)
    } else {
        address
            .rsplit_once(':')
            .map(|(host, _)| host)
            .unwrap_or(address)
    };
    url_from_host_and_port(host, port)
}

pub fn assemble_run_environments(
    live: &[LiveCommandTerminal],
    listening: &[TerminalPortInfo],
    worktrees: &[WorktreeRef],
    projects: &[ProjectRef],
    configured_ports: &HashMap<String, Vec<PortEntry>>,
    filter: &RunEnvironmentFilter,
) -> RunEnvironmentsResult {
    let worktrees_by_path = worktrees
        .iter()
        .map(|worktree| (normalize_path(&worktree.path), worktree))
        .collect::<HashMap<_, _>>();
    let projects_by_id = projects
        .iter()
        .map(|project| (project.id.as_str(), project))
        .collect::<HashMap<_, _>>();
    let mut environments = live
        .iter()
        .filter_map(|terminal| {
            let worktree = worktrees_by_path.get(&normalize_path(&terminal.worktree_path))?;
            if filter
                .worktree_id
                .as_deref()
                .is_some_and(|id| id != worktree.id)
                || filter
                    .project_id
                    .as_deref()
                    .is_some_and(|id| id != worktree.project_id)
            {
                return None;
            }
            let project = projects_by_id.get(worktree.project_id.as_str());
            let mut ports = Vec::new();
            for info in listening
                .iter()
                .filter(|info| info.terminal_id == terminal.terminal_id)
            {
                let configured_host = configured_ports
                    .get(&worktree.id)
                    .into_iter()
                    .flatten()
                    .find(|entry| entry.port == info.port)
                    .and_then(|entry| entry.host.as_deref());
                ports.push(RunEnvironmentPort {
                    port: info.port,
                    process_name: Some(info.process_name.clone()),
                    local_address: Some(info.local_address.clone()),
                    url: configured_host.map_or_else(
                        || url_from_listen_address(&info.local_address, info.port),
                        |host| url_from_host_and_port(host, info.port),
                    ),
                    source: "listening",
                });
            }
            for entry in configured_ports.get(&worktree.id).into_iter().flatten() {
                if ports.iter().any(|port| port.port == entry.port) {
                    continue;
                }
                ports.push(RunEnvironmentPort {
                    port: entry.port,
                    process_name: None,
                    local_address: None,
                    url: url_from_host_and_port(
                        entry.host.as_deref().unwrap_or("127.0.0.1"),
                        entry.port,
                    ),
                    source: "configured",
                });
            }
            let url = ports.first().map(|port| port.url.clone());
            Some(RunEnvironment {
                running: true,
                terminal_id: terminal.terminal_id.clone(),
                worktree_id: Some(worktree.id.clone()),
                worktree_name: Some(worktree.name.clone()),
                worktree_path: worktree.path.clone(),
                is_base_session: worktree.is_base,
                project_id: Some(worktree.project_id.clone()),
                project_name: project.map(|project| project.name.clone()),
                session_id: None,
                command: terminal.command.clone(),
                command_args: terminal.command_args.clone(),
                ports,
                url,
            })
        })
        .collect::<Vec<_>>();
    environments.sort_by(|a, b| {
        a.worktree_name
            .cmp(&b.worktree_name)
            .then_with(|| a.command.cmp(&b.command))
    });
    RunEnvironmentsResult { environments }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_configured_and_listening_ports_for_matching_worktree() {
        let result = assemble_run_environments(
            &[LiveCommandTerminal {
                terminal_id: "term-1".into(),
                worktree_path: "/repo/feature/".into(),
                command: "bun run dev".into(),
                command_args: None,
            }],
            &[TerminalPortInfo {
                terminal_id: "term-1".into(),
                port: 5173,
                process_name: "bun".into(),
                local_address: "*:5173".into(),
            }],
            &[WorktreeRef {
                id: "wt-1".into(),
                name: "feature".into(),
                path: "/repo/feature".into(),
                project_id: "project-1".into(),
                is_base: false,
            }],
            &[ProjectRef {
                id: "project-1".into(),
                name: "repo".into(),
            }],
            &HashMap::from([(
                "wt-1".into(),
                vec![PortEntry {
                    port: 3000,
                    label: "app".into(),
                    host: Some("localhost".into()),
                }],
            )]),
            &RunEnvironmentFilter::default(),
        );
        assert_eq!(result.environments.len(), 1);
        let environment = &result.environments[0];
        assert_eq!(environment.url.as_deref(), Some("http://127.0.0.1:5173"));
        assert_eq!(environment.ports.len(), 2);
        assert_eq!(environment.ports[1].url, "http://localhost:3000");
    }

    #[test]
    fn filters_run_environments_by_worktree_or_project() {
        let live = [LiveCommandTerminal {
            terminal_id: "term-1".into(),
            worktree_path: "/repo/feature".into(),
            command: "bun run dev".into(),
            command_args: None,
        }];
        let worktrees = [WorktreeRef {
            id: "wt-1".into(),
            name: "feature".into(),
            path: "/repo/feature".into(),
            project_id: "project-1".into(),
            is_base: false,
        }];
        assert!(assemble_run_environments(
            &live,
            &[],
            &worktrees,
            &[],
            &HashMap::new(),
            &RunEnvironmentFilter {
                worktree_id: Some("other".into()),
                project_id: None
            }
        )
        .environments
        .is_empty());
        assert_eq!(
            assemble_run_environments(
                &live,
                &[],
                &worktrees,
                &[],
                &HashMap::new(),
                &RunEnvironmentFilter {
                    worktree_id: Some("wt-1".into()),
                    project_id: Some("project-1".into())
                }
            )
            .environments
            .len(),
            1
        );
    }
}
