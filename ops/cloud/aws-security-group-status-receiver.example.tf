# EXAMPLE ONLY. AWS security group sketch for a hosted status receiver.
# Keep the Python receiver bound to localhost and expose only HTTPS through a
# reverse proxy. Do not place broker credentials or private strategy configs on
# this host.

variable "name" {
  type    = string
  default = "algo-trade-status-receiver"
}

variable "vpc_id" {
  type = string
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

resource "aws_security_group" "status_receiver" {
  name        = var.name
  description = "HTTPS-only access to sanitized algo-trade status receiver"
  vpc_id      = var.vpc_id

  ingress {
    description = "SSH from management networks"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_cidrs
  }

  ingress {
    description = "HTTPS status/dashboard access"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = local.https_cidrs
  }

  egress {
    description = "Outbound HTTPS/DNS/package updates"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

output "status_receiver_security_group_id" {
  value = aws_security_group.status_receiver.id
}
