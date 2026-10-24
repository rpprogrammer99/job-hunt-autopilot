/**
 * The ONE place demo application data lives. Do not duplicate this anywhere
 * else — components read applications through the data service only.
 *
 * All records here are fictional and tagged `source: "demo"`.
 */
import type { Application } from "../types";

export const SAMPLE_APPLICATIONS: Application[] = [
  {
    id: "demo-1",
    company: "Northwind Analytics",
    jobTitle: "Frontend Engineer",
    location: "Remote (US)",
    status: "interview",
    emailDate: "2026-10-05T09:12:00Z",
    lastUpdated: "2026-10-18T14:30:00Z",
    nextFollowUp: "2026-10-25T00:00:00Z",
    source: "demo",
    email: {
      from: "talent@northwind-analytics.com",
      subject: "Interview invitation — Frontend Engineer",
      receivedAt: "2026-10-05T09:12:00Z",
      snippet:
        "We enjoyed reviewing your application and would like to invite you to a technical interview next week.",
    },
    scam: { suspicious: false, reasons: [], provider: "demo" },
    notes: "Panel interview scheduled.",
  },
  {
    id: "demo-2",
    company: "Brightwave Systems",
    jobTitle: "Full-Stack Developer",
    location: "Austin, TX",
    status: "assessment",
    emailDate: "2026-10-08T11:00:00Z",
    lastUpdated: "2026-10-12T10:05:00Z",
    nextFollowUp: "2026-10-26T00:00:00Z",
    source: "demo",
    email: {
      from: "recruiting@brightwave.io",
      subject: "Coding assessment — Full-Stack Developer",
      receivedAt: "2026-10-08T11:00:00Z",
      snippet:
        "Please complete the take-home coding assessment within 5 days using the link below.",
    },
    scam: { suspicious: false, reasons: [], provider: "demo" },
  },
  {
    id: "demo-3",
    company: "Acme Cloud",
    jobTitle: "Software Engineer II",
    location: "Seattle, WA",
    status: "applied",
    emailDate: "2026-10-15T08:45:00Z",
    lastUpdated: "2026-10-15T08:45:00Z",
    nextFollowUp: "2026-10-22T00:00:00Z",
    source: "demo",
    email: {
      from: "careers@acmecloud.com",
      subject: "Thank you for applying to Acme Cloud",
      receivedAt: "2026-10-15T08:45:00Z",
      snippet:
        "We have received your application and our team is reviewing it. We will be in touch.",
    },
    scam: { suspicious: false, reasons: [], provider: "demo" },
  },
  {
    id: "demo-4",
    company: "FinchPay",
    jobTitle: "Backend Engineer",
    location: "Remote (EU)",
    status: "applied",
    emailDate: "2026-10-16T16:45:00Z",
    lastUpdated: "2026-10-16T16:45:00Z",
    nextFollowUp: "2026-10-23T00:00:00Z",
    source: "demo",
    email: {
      from: "talent@finchpay.com",
      subject: "We received your application — Backend Engineer",
      receivedAt: "2026-10-16T16:45:00Z",
      snippet:
        "This confirms your application for the Backend Engineer role. Recruiters typically respond within two weeks.",
    },
    scam: { suspicious: false, reasons: [], provider: "demo" },
  },
  {
    id: "demo-5",
    company: "Quantum Labs",
    jobTitle: "Machine Learning Engineer",
    location: "Boston, MA",
    status: "offer",
    emailDate: "2026-09-28T13:20:00Z",
    lastUpdated: "2026-10-19T09:00:00Z",
    nextFollowUp: null,
    source: "demo",
    email: {
      from: "offers@quantumlabs.ai",
      subject: "Your offer from Quantum Labs",
      receivedAt: "2026-09-28T13:20:00Z",
      snippet:
        "We are delighted to extend an offer for the Machine Learning Engineer position.",
    },
    scam: { suspicious: false, reasons: [], provider: "demo" },
    notes: "Reviewing compensation details.",
  },
  {
    id: "demo-6",
    company: "NovaData",
    jobTitle: "Data Analyst",
    location: "Chicago, IL",
    status: "rejected",
    emailDate: "2026-09-20T10:00:00Z",
    lastUpdated: "2026-10-10T11:00:00Z",
    nextFollowUp: null,
    source: "demo",
    email: {
      from: "recruiting@novadata.com",
      subject: "Application update — Data Analyst role",
      receivedAt: "2026-09-20T10:00:00Z",
      snippet:
        "After careful review, we have decided to move forward with other candidates at this time.",
    },
    scam: { suspicious: false, reasons: [], provider: "demo" },
  },
  {
    id: "demo-7",
    company: "Skyline Retail Group",
    jobTitle: "Remote Data Entry Specialist",
    location: "Remote",
    status: "applied",
    emailDate: "2026-10-14T03:04:00Z",
    lastUpdated: "2026-10-14T03:04:00Z",
    nextFollowUp: "2026-10-21T00:00:00Z",
    source: "demo",
    email: {
      from: "hr-dept@skyline-retail-secure.xyz",
      subject: "URGENT: You are hired! Pay onboarding fee to start",
      receivedAt: "2026-10-14T03:04:00Z",
      snippet:
        "Congratulations! No interview required. To secure your spot, pay a $250 onboarding fee via gift cards and send your SSN and bank details immediately. Offer expires in 2 hours!",
    },
    // Demo placeholder analysis — NOT a real AI verdict. Flagged by obvious
    // keyword hints only, and clearly labeled as demo in the UI.
    scam: {
      suspicious: true,
      reasons: [
        "Requests an upfront onboarding fee",
        "Asks for payment via gift cards",
        "Requests SSN and bank details early",
        "Hiring without any interview",
        "Creates artificial urgency",
        "Sender domain looks untrustworthy",
      ],
      provider: "demo",
    },
    notes: "Likely a scam — do not respond.",
  },
  {
    id: "demo-8",
    company: "Meridian Health Tech",
    jobTitle: "DevOps Engineer",
    location: "Denver, CO",
    status: "interview",
    emailDate: "2026-10-02T15:30:00Z",
    lastUpdated: "2026-10-09T12:00:00Z",
    nextFollowUp: "2026-10-16T00:00:00Z",
    source: "demo",
    email: {
      from: "people@meridianhealthtech.com",
      subject: "Next steps — DevOps Engineer interview",
      receivedAt: "2026-10-02T15:30:00Z",
      snippet:
        "Thanks for the great first conversation. We'd like to schedule a follow-up system-design interview.",
    },
    scam: { suspicious: false, reasons: [], provider: "demo" },
  },
  {
    id: "demo-9",
    company: "Cedar & Pine Design",
    jobTitle: "Product Designer",
    location: "Remote (US)",
    status: "assessment",
    emailDate: "2026-10-11T09:00:00Z",
    lastUpdated: "2026-10-11T09:00:00Z",
    nextFollowUp: "2026-10-18T00:00:00Z",
    source: "demo",
    email: {
      from: "hiring@cedarpine.design",
      subject: "Design exercise — Product Designer",
      receivedAt: "2026-10-11T09:00:00Z",
      snippet:
        "We'd love for you to complete a short design exercise so we can see your process.",
    },
    scam: { suspicious: false, reasons: [], provider: "demo" },
  },
];
