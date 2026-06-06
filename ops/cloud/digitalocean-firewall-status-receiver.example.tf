# EXAMPLE ONLY. DigitalOcean Cloud Firewall sketch for a hosted status
# receiver Droplet. Keep the Python receiver bound to localhost and expose only
# HTTPS through nginx/Caddy or a private VPN/proxy.

terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = ">= 2.0"
    }
  }
}

variable "name" {
  type    = string
  default = "algo-trade-status-receiver"
}

variable "droplet_ids" {
  type        = list(number)
  description = "Droplet IDs running the hosted receiver reverse proxy."
}

variable "ssh_cidrs" {
  type        = list(string)
  description = "Management CIDRs allowed to SSH to the host."
}

variable "publisher_cidrs" {
  type        = list(string)
  description = "Trading-machine, VPN, or office CIDRs allowed to post status."
}

variable "dashboard_cidrs" {
  type        = list(string)
  description = "CIDRs allowed to view the dashboard over HTTPS."
  default     = []
}

locals {
  https_cidrs = distinct(concat(var.publisher_cidrs, var.dashboard_cidrs))
}

resource "digitalocean_firewall" "status_receiver" {
  name        = var.name
  droplet_ids = var.droplet_ids

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_cidrs
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = local.https_cidrs
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

output "status_receiver_firewall_id" {
  value = digitalocean_firewall.status_receiver.id
}
