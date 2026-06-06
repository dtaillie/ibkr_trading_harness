# EXAMPLE ONLY. Azure Blob immutability sketch for off-host command-audit
# retention.
#
# Use this for hosted receiver command_audit.jsonl copies, not for broker
# credentials, raw logs, private strategy configs, or local data. Start with an
# unlocked immutability policy while testing. Setting lock_immutability_policy
# to true is irreversible.

terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 4.0"
    }
  }
}

provider "azurerm" {
  features {}
}

variable "resource_group_name" {
  type        = string
  description = "Resource group for command-audit retention storage."
}

variable "location" {
  type        = string
  description = "Azure region for command-audit retention storage."
  default     = "eastus"
}

variable "storage_account_name" {
  type        = string
  description = "Globally unique lowercase storage account name."
}

variable "retention_days" {
  type        = number
  description = "Immutability retention period for uploaded audit blobs."
  default     = 30
}

variable "lock_immutability_policy" {
  type        = bool
  description = "Irreversibly lock the container immutability policy after review."
  default     = false
}

variable "writer_principal_ids" {
  type        = list(string)
  description = "Azure AD principal object IDs allowed to upload command-audit blobs."
}

variable "reader_principal_ids" {
  type        = list(string)
  description = "Azure AD principal object IDs allowed to read retained command-audit blobs."
  default     = []
}

locals {
  container_name = "command-audit"
}

resource "azurerm_resource_group" "command_audit" {
  name     = var.resource_group_name
  location = var.location
}

resource "azurerm_storage_account" "command_audit" {
  name                     = var.storage_account_name
  resource_group_name      = azurerm_resource_group.command_audit.name
  location                 = azurerm_resource_group.command_audit.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"
  min_tls_version          = "TLS1_2"

  allow_nested_items_to_be_public = false

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = var.retention_days
    }

    container_delete_retention_policy {
      days = var.retention_days
    }
  }

  tags = {
    purpose = "algo-trade-command-audit"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_storage_container" "command_audit" {
  name                  = local.container_name
  storage_account_name  = azurerm_storage_account.command_audit.name
  container_access_type = "private"
}

resource "azurerm_storage_container_immutability_policy" "command_audit" {
  storage_container_resource_manager_id = azurerm_storage_container.command_audit.id
  immutability_period_in_days           = var.retention_days
  protected_append_writes_all_enabled   = true
  locked                                = var.lock_immutability_policy
}

resource "azurerm_role_assignment" "audit_writers" {
  for_each             = toset(var.writer_principal_ids)
  scope                = azurerm_storage_container.command_audit.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "audit_readers" {
  for_each             = toset(var.reader_principal_ids)
  scope                = azurerm_storage_container.command_audit.id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = each.value
}

output "command_audit_storage_account" {
  value = azurerm_storage_account.command_audit.name
}

output "command_audit_container" {
  value = azurerm_storage_container.command_audit.name
}

output "rclone_destination_example" {
  value = "azureblob:${azurerm_storage_account.command_audit.name}/${azurerm_storage_container.command_audit.name}/receiver-a/command_audit.jsonl"
}
