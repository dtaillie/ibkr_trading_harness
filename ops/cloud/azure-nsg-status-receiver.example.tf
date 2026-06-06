# Example Azure Network Security Group boundary for a hosted status receiver.
#
# This is a starting sketch, not a complete deployment. Keep the receiver bound
# to localhost behind a reverse proxy; expose only SSH from management networks
# and HTTPS from publisher/dashboard networks.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

variable "resource_group_name" {
  description = "Resource group for the receiver VM/network resources."
  type        = string
}

variable "location" {
  description = "Azure region for the Network Security Group."
  type        = string
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

resource "azurerm_network_security_group" "status_receiver" {
  name                = "algo-trade-status-receiver"
  location            = var.location
  resource_group_name = var.resource_group_name
}

resource "azurerm_network_security_rule" "status_receiver_ssh" {
  name                        = "allow-ssh-management"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "22"
  source_address_prefixes     = var.management_cidrs
  destination_address_prefix  = "*"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.status_receiver.name
}

resource "azurerm_network_security_rule" "status_receiver_https" {
  name                        = "allow-https-publisher-dashboard"
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefixes     = var.publisher_dashboard_cidrs
  destination_address_prefix  = "*"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.status_receiver.name
}
