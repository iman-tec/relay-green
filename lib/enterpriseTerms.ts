/*
 * Enterprise MSA — the org-level terms of record, distinct from the Channel
 * Partner commercial terms (lib/billing/partnerTerms). One authorized signer
 * (the enterprise admin) binds the whole organization; departments + employees
 * act under it and never re-sign. Pure constants (client-safe).
 *
 * Material change => bump ENTERPRISE_MSA_VERSION; the gate then requires a fresh
 * acceptance on next entry (a new terms_acceptances row, terms_type='enterprise_msa').
 */

export const ENTERPRISE_MSA_VERSION = "2026-06-07";

export const ENTERPRISE_MSA_URL = "/legal/terms-commercial";

export const ENTERPRISE_MSA_STATEMENT =
  "I confirm I am authorized to bind my organization, and on its behalf I agree " +
  "to the Relay.green Master Services Agreement as published at " +
  ENTERPRISE_MSA_URL +
  " (version " +
  ENTERPRISE_MSA_VERSION +
  "). I understand this acceptance binds my organization's departments and members.";
