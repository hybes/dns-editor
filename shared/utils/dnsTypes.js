// Record types the DNS tools accept, shared by the server routes that enforce them and the
// pages that offer or link to them.

// DNS Lookup (DNS-over-HTTPS).
export const LOOKUP_RECORD_TYPES = [
	'A',
	'AAAA',
	'CNAME',
	'MX',
	'NS',
	'TXT',
	'SOA',
	'SRV',
	'CAA',
	'PTR',
	'DS',
	'DNSKEY',
	'HTTPS',
	'SVCB',
	'TLSA',
	'NAPTR'
]

// Propagation Check (plain DNS to each resolver and name server).
export const PROPAGATION_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'CAA', 'PTR']
