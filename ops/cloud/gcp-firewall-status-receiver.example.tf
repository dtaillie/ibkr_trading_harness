# Example GCP firewall boundary for a hosted status receiver.
#
# This is a starting sketch, not a complete deployment. Keep the receiver bound
# to localhost behind a reverse proxy; expose only SSH from management networks
# and HTTPS from publisher/dashboard networks.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
  }
}

variable "network" {
  description = "VPC network name."
  type        = string
  default     = "default"
}

variable "target_tags" {
  description = "Network tags attached to the receiver VM."
  type        = list(string)
  default     = ["algo-trade-status-receiver"]
}

variable "management_cidrs" {
  description = "CIDR ranges allowed to SSH to the receiver VM."
  type        = list(string)
  default     = ["203.0.113.10/32"]
}

variable "publisher_dashboard_cidrs" {
  description = "CIDR ranges allowed to reach the HTTPS reverse proxy."
  type        = list(string)
  default     = ["203.0.113.10/32"]
}

resource "google_compute_firewall" "status_receiver_ssh" {
  name          = "algo-trade-status-receiver-ssh"
  network       = var.network
  direction     = "INGRESS"
  source_ranges = var.management_cidrs
  target_tags   = var.target_tags

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_firewall" "status_receiver_https" {
  name          = "algo-trade-status-receiver-https"
  network       = var.network
  direction     = "INGRESS"
  source_ranges = var.publisher_dashboard_cidrs
  target_tags   = var.target_tags

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }
}
