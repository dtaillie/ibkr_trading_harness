# EXAMPLE ONLY. GCS Bucket Lock sketch for off-host command-audit retention.
#
# Use this for hosted receiver command_audit.jsonl copies, not for broker
# credentials, raw logs, private strategy configs, or local data. Start with an
# unlocked retention policy while testing. Setting lock_retention_policy=true is
# irreversible for the bucket retention policy.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
  }
}

variable "project_id" {
  type        = string
  description = "Google Cloud project that owns the command-audit bucket."
}

variable "bucket_name" {
  type        = string
  description = "Globally unique GCS bucket name for command-audit retention."
}

variable "location" {
  type        = string
  description = "GCS bucket location."
  default     = "US"
}

variable "retention_days" {
  type        = number
  description = "Retention period for uploaded audit objects."
  default     = 30
}

variable "lock_retention_policy" {
  type        = bool
  description = "Irreversibly lock the bucket retention policy after review."
  default     = false
}

variable "writer_members" {
  type        = list(string)
  description = "IAM members allowed to create command-audit objects, for example serviceAccount:writer@example.iam.gserviceaccount.com."
}

variable "reader_members" {
  type        = list(string)
  description = "IAM members allowed to read retained command-audit objects."
  default     = []
}

locals {
  audit_prefix      = "command-audit/"
  retention_seconds = var.retention_days * 86400
}

resource "google_storage_bucket" "command_audit" {
  project  = var.project_id
  name     = var.bucket_name
  location = var.location

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  retention_policy {
    retention_period = local.retention_seconds
    is_locked        = var.lock_retention_policy
  }

  labels = {
    purpose = "algo-trade-command-audit"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_storage_bucket_iam_binding" "audit_writers" {
  bucket  = google_storage_bucket.command_audit.name
  role    = "roles/storage.objectCreator"
  members = var.writer_members
}

resource "google_storage_bucket_iam_binding" "audit_readers" {
  count   = length(var.reader_members) > 0 ? 1 : 0
  bucket  = google_storage_bucket.command_audit.name
  role    = "roles/storage.objectViewer"
  members = var.reader_members
}

output "command_audit_bucket" {
  value = google_storage_bucket.command_audit.name
}

output "command_audit_prefix" {
  value = local.audit_prefix
}

output "rclone_destination_example" {
  value = "gcs:${google_storage_bucket.command_audit.name}/${local.audit_prefix}receiver-a/command_audit.jsonl"
}
