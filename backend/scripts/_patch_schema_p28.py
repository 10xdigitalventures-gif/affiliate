import io, sys

P = 'prisma/schema.prisma'
s = io.open(P, encoding='utf-8').read()
orig = s

# 1) Enums after FraudReviewStatus
anchor = 'enum FraudReviewStatus { open approved rejected }'
assert s.count(anchor) == 1, 'enum anchor'
s = s.replace(anchor, anchor + '\n' + 'enum PlanInterval ' + chr(123) + ' month year ' + chr(125) + '\n' + 'enum SubscriptionStatus ' + chr(123) + ' active trialing past_due canceled ' + chr(125))

# 2) isSuperAdmin on User
uanchor = '  twoFactorEnabled Boolean   @default(false)'
assert s.count(uanchor) == 1, 'user anchor'
s = s.replace(uanchor, uanchor + '\n  isSuperAdmin   Boolean    @default(false)')

# 3) Organization relation (unique block: invitations + fraudReviews + closing brace)
oanchor = '  invitations  Invitation[]\n  fraudReviews FraudReview[]\n}'
assert s.count(oanchor) == 1, 'org anchor'
s = s.replace(oanchor, '  invitations  Invitation[]\n  fraudReviews FraudReview[]\n  subscription Subscription?\n}')

# 4) Append models
q = chr(34)
lb = chr(123)
rb = chr(125)
models = '''

model Plan {
  id            String       @id @default(uuid())
  key           String       @unique
  name          String
  description   String?
  priceCents    Int          @default(0)
  currency      String       @default(QUSDQ) @db.Char(3)
  interval      PlanInterval @default(month)
  features      Json         @default(QEMPTYQ)
  limits        Json         @default(QEMPTYQ)
  isPublic      Boolean      @default(true)
  isArchived    Boolean      @default(false)
  sortOrder     Int          @default(0)
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
  subscriptions Subscription[]
}

model Subscription {
  id               String             @id @default(uuid())
  organizationId   String             @unique
  planId           String
  status           SubscriptionStatus @default(trialing)
  currentPeriodEnd DateTime?
  trialEndsAt      DateTime?
  seats            Int                @default(0)
  overrides        Json?
  externalRef      String?
  createdAt        DateTime           @default(now())
  updatedAt        DateTime           @updatedAt
  organization     Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  plan             Plan               @relation(fields: [planId], references: [id])
  @@index([planId])
}
'''
models = models.replace('QUSDQ', q + 'USD' + q).replace('QEMPTYQ', q + rb.join([lb]) + q if False else q + lb + rb + q)
s = s + models

assert s != orig, 'no change'
io.open(P, 'w', encoding='utf-8').write(s)
print('OK enums=%d plan=%d sub=%d superadmin=%d' % (s.count('enum PlanInterval'), s.count('model Plan '), s.count('model Subscription '), s.count('isSuperAdmin')))
