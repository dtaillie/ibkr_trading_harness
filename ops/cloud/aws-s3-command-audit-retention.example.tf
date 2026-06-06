# EXAMPLE ONLY. S3 Object Lock sketch for off-host command-audit retention.
#
# Use this for the hosted receiver's sanitized command_audit.jsonl copies, not
# for broker credentials, raw logs, private strategy configs, or local data.
# Object Lock must be enabled when the bucket is created; do not apply this to
# an existing bucket without reviewing AWS's Object Lock requirements.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "bucket_name" {
  type        = string
  description = "Globally unique S3 bucket name for command-audit retention."
}

variable "retention_days" {
  type        = number
  description = "Default Object Lock retention period for uploaded audit rows."
  default     = 30
}

variable "writer_principal_arns" {
  type        = list(string)
  description = "IAM role/user ARNs allowed to upload command-audit objects."
}

variable "reader_principal_arns" {
  type        = list(string)
  description = "IAM role/user ARNs allowed to read retained audit objects."
  default     = []
}

locals {
  audit_prefix = "command-audit/"
}

resource "aws_s3_bucket" "command_audit" {
  bucket              = var.bucket_name
  object_lock_enabled = true
}

resource "aws_s3_bucket_public_access_block" "command_audit" {
  bucket                  = aws_s3_bucket.command_audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "command_audit" {
  bucket = aws_s3_bucket.command_audit.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "command_audit" {
  bucket = aws_s3_bucket.command_audit.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_object_lock_configuration" "command_audit" {
  bucket = aws_s3_bucket.command_audit.id

  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = var.retention_days
    }
  }
}

data "aws_iam_policy_document" "command_audit" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.command_audit.arn,
      "${aws_s3_bucket.command_audit.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid    = "DenyGovernanceBypass"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:BypassGovernanceRetention"]

    resources = [
      aws_s3_bucket.command_audit.arn,
      "${aws_s3_bucket.command_audit.arn}/*",
    ]
  }

  statement {
    sid    = "AllowAuditWrites"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = var.writer_principal_arns
    }

    actions = [
      "s3:PutObject",
      "s3:PutObjectRetention",
      "s3:PutObjectTagging",
    ]

    resources = ["${aws_s3_bucket.command_audit.arn}/${local.audit_prefix}*"]
  }

  statement {
    sid    = "AllowAuditList"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = concat(var.writer_principal_arns, var.reader_principal_arns)
    }

    actions = ["s3:ListBucket"]

    resources = [aws_s3_bucket.command_audit.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.audit_prefix}*"]
    }
  }

  statement {
    sid    = "AllowAuditReads"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = concat(var.writer_principal_arns, var.reader_principal_arns)
    }

    actions = [
      "s3:GetObject",
      "s3:GetObjectRetention",
    ]

    resources = ["${aws_s3_bucket.command_audit.arn}/${local.audit_prefix}*"]
  }
}

resource "aws_s3_bucket_policy" "command_audit" {
  bucket = aws_s3_bucket.command_audit.id
  policy = data.aws_iam_policy_document.command_audit.json
}

output "command_audit_bucket" {
  value = aws_s3_bucket.command_audit.bucket
}

output "command_audit_prefix" {
  value = local.audit_prefix
}
