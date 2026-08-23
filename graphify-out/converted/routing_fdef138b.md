<!-- converted from routing.docx -->

For a lost phone case, the safest routing is Police + CEIR first, and Cybercrime/1930 if there is any banking, OTP, SIM, or account misuse risk. Below are proper state-wise links you can directly plug into the app UI.
Core links
These should appear for all four states:
CEIR mobile blocking portal: https://www.ceir.gov.in
National Cybercrime Reporting Portal: https://cybercrime.gov.in
Cyber financial fraud helpline: 1930
State routing

App wording
Use this exact routing text in the app:
If phone is only lost: “File a lost phone report with the state police portal or nearest police station, then block the handset on CEIR.”
If phone was stolen/snatched: “File a theft complaint/FIR with police immediately, then block the device on CEIR.”
If OTP/bank/UPI/SIM misuse risk exists: “Call 1930 immediately and file on the National Cybercrime Portal, then also report to police and block the device on CEIR.”
Recommended product logic
Route the case like this:
If text contains “lost/missing phone” and no theft/fraud indicators → POLICE_LOST_REPORT + CEIR.
If text contains “stolen/snatched/pickpocket/robbed” → POLICE_THEFT_ROUTE + CEIR.
If text contains “OTP/UPI/bank/WhatsApp/SIM misuse” → CYBERCRIME_PORTAL + 1930 + POLICE + CEIR.
Do not route phone-lost cases to Gram Nyayalaya.
Clean link bundle
You can store this in your app config:
ceir: https://www.ceir.gov.in
cybercrime: https://cybercrime.gov.in
delhi_police_lost: https://lostfound.delhipolice.gov.in
delhi_police: https://delhipolice.gov.in
bihar_police: https://biharpolice.bihar.gov.in
up_police: https://uppolice.gov.in
wb_police: https://wbpolice.gov.in
Would you like the next step as a ready-to-paste JSON object for your routing engine?


When to route to DLSA / NALSA
Route to DLSA/SLSA/NALSA support when any of these are true:
Woman facing violence, abandonment, maintenance issue, or coercion.
Child-related issue.
Senior citizen, person with disability, poor/vulnerable person, labourer, rural litigant, or person clearly unable to hire counsel.
User needs drafting help, filing help, legal counselling, mediation/conciliation guidance, or help understanding where to go.
User has a court-worthy grievance but forum is unclear.
User is eligible for legal aid or likely eligible.
User has already been harmed but is confused about police/court/authority sequence.
So DLSA is often a parallel assist route, not always the main route.
Routing hierarchy
Use this order:
Immediate danger / violence / serious crime
Primary: Police
Legal aid support: DLSA
Cyber fraud / digital misuse
Primary: Cyber Cell / 1930
Legal aid support: DLSA only if victim is vulnerable, needs follow-up help, or needs complaint drafting
Rural local civil dispute like wage, pathway, water, small possession issue
Primary: Gram Nyayalaya candidate or manual review
Legal aid support: DLSA
Family / maintenance / domestic violence
Primary: DLSA-supported family/DV pathway, plus police if urgent
Legal aid support: DLSA definitely yes
Document / certificate / service denial
Primary: concerned department / grievance office
Legal aid support: DLSA if repeated denial, discrimination, or access problem
Forum unclear
Primary: Manual review
Legal aid support: DLSA
Case types that should trigger DLSA strongly
Use legal_aid_support = true for these issue types by default:
domestic_violence
maintenance_family
wage_dispute
land_possession
water_irrigation
pathway_boundary
minor_threat_intimidation
document_or_certificate when vulnerable person is involved
other when user seems poor, distressed, elderly, disabled, or confused
Use it conditionally for:
cyber_fraud
serious_crime
Good frontend labels
Instead of saying only “Go to DLSA,” use these labels:
Free legal aid available
Get drafting and filing help
Support for women / senior citizens / vulnerable persons
Need help understanding where to file?
This makes DLSA feel useful, not secondary.
Links to use
Use these as your base support links in the app config:
NALSA: https://nalsa.gov.in
Legal Services portal: https://legalaid.gov.in
State-level links you can keep in config:
Delhi: https://dslsa.org
Bihar: https://bslsa.bihar.gov.in
Uttar Pradesh: https://upslsa.up.nic.in
West Bengal: https://wbslsa.bangla.gov.in


## Suggested routing object
Use a structure like this:
{
"primary_forum": "Police Station",
"secondary_forum": "Cyber Cell",
"legal_aid_support": {
"enabled": true,
"level": "DLSA",
"reason": "User may need free legal help, drafting support, and forum guidance.",
"links": {
"national": "https://nalsa.gov.in",
"legal_aid": "https://legalaid.gov.in",
"state": "STATE_SPECIFIC_LINK"
}
}
}


## State-wise DLSA/SLSA mapping
Use this map:
{
"Delhi": {
"legal_aid_level": "DLSA/DSLSA",
"state_link": "https://dslsa.org"
},
"Bihar": {
"legal_aid_level": "DLSA/BSLSA",
"state_link": "https://bslsa.bihar.gov.in"
},
"Uttar Pradesh": {
"legal_aid_level": "DLSA/UPSLSA",
"state_link": "https://upslsa.up.nic.in"
},
"West Bengal": {
"legal_aid_level": "DLSA/WBSLSA",
"state_link": "https://wbslsa.bangla.gov.in"
}
}






## Recommended case-to-routing table
Here is the clean version for your app:





Best app behaviour:
On the result page, always show:
Recommended forum
Free legal aid available?
Why legal aid is being suggested
Open legal aid link
State legal aid link
Need drafting help? Connect to DLSA

Add this helper:

function shouldSuggestLegalAid(caseData) {
if (caseData.vulnerable_user_flag) return true;
if (["domestic_violence","maintenance_family","wage_dispute","land_possession","water_irrigation","pathway_boundary","other"].includes(caseData.issue_type)) return true;
if (caseData.manual_review_required) return true;
return false;
}

| State | Primary route | Theft/snatching route | Fraud-risk route |
| --- | --- | --- | --- |
| Delhi | Delhi Police Lost Report: https://lostfound.delhipolice.gov.in | Delhi Police e-FIR/services portal: https://delhipolice.gov.in | Cybercrime portal + 1930 + Delhi Police cyber/services portal: https://cybercrime.gov.in, https://delhipolice.gov.in |
| Bihar | Local police / Bihar Police portal: https://biharpolice.bihar.gov.in | Bihar Police complaint route/local PS via state portal: https://biharpolice.bihar.gov.in | Cybercrime portal + 1930 + Bihar Police portal: https://cybercrime.gov.in, https://biharpolice.bihar.gov.in |
| Uttar Pradesh | UP Police citizen services: https://uppolice.gov.in | UP Police complaint/FIR support via state portal: https://uppolice.gov.in | Cybercrime portal + 1930 + UP Police portal: https://cybercrime.gov.in, https://uppolice.gov.in |
| West Bengal | West Bengal Police portal: https://wbpolice.gov.in | West Bengal Police complaint route/local PS via state portal: https://wbpolice.gov.in | Cybercrime portal + 1930 + WB Police cyber page: https://cybercrime.gov.in, https://wbpolice.gov.in |
| Case type | Primary forum | Add DLSA? | Notes |
| --- | --- | --- | --- |
| Cyber fraud | Cyber Cell | Conditional | Add when user is vulnerable or needs follow-up help. |
| Domestic violence | Police / DV support path | Yes | DLSA should almost always appear. |
| Maintenance / family | Family/DV/legal aid path | Yes | DLSA should be strong default. |
| Wage dispute | Gram Nyayalaya candidate / labour path | Yes | Good legal-aid use case. |
| Land possession | Gram Nyayalaya candidate / court path | Yes | Drafting and forum guidance needed. |
| Water / irrigation | Gram Nyayalaya candidate | Yes | Strong rural legal-aid support use case. |
| Pathway / boundary | Gram Nyayalaya candidate | Yes | Good for local dispute support. |
| Minor threat / intimidation | Police or local forum | Yes | Especially where complainant is vulnerable. |
| Serious crime | Police | Conditional | Add DLSA if victim support / legal follow-up needed. |
| Document / certificate | Department grievance | Conditional | Add if denial persists or user is vulnerable. |
| Other | Manual review | Yes | Safest support fallback. |