# 📋 Address Book Feature - Detailed Implementation Roadmap

## 📅 Phase-by-Phase Implementation Guide

---

## 🏗️ Phase 1: Foundation (Day 1-2)

### 1.1 Type Definitions & Interfaces
**File**: `types/index.ts`

```typescript
// Add to existing types/index.ts
export interface Contact {
  id: string;              // UUID for unique identification
  name: string;            // Display name (user-friendly)
  address: string;         // Warthog wallet address (42 chars)
  notes?: string;          // Optional user notes
  createdAt: Date;         // Creation timestamp
  lastUsed?: Date;         // Last used in transaction
  isFavorite?: boolean;    // Star/favorite status
  usageCount: number;      // Track frequency for smart sorting
}

export interface ContactFormData {
  name: string;
  address: string;
  notes?: string;
}

export interface AddressBookState {
  contacts: Contact[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  sortBy: 'name' | 'recent' | 'frequency';
}
```

**Tasks:**
- [ ] Add Contact interface to types
- [ ] Add form validation types
- [ ] Add state management types
- [ ] Export all new types

---

### 1.2 Storage Utilities
**File**: `utils/contactStorage.ts`

```typescript
// New file: utils/contactStorage.ts
import * as SecureStore from 'expo-secure-store';
import { Contact, ContactFormData } from '../types';

export class ContactStorage {
  private static readonly STORAGE_KEY = 'warthog_contacts_v1';

  // Core CRUD operations
  static async getContacts(): Promise<Contact[]>
  static async saveContact(contact: ContactFormData): Promise<Contact>
  static async updateContact(id: string, updates: Partial<Contact>): Promise<Contact>
  static async deleteContact(id: string): Promise<boolean>
  
  // Utility operations
  static async findByAddress(address: string): Promise<Contact | null>
  static async incrementUsage(id: string): Promise<void>
  static async exportContacts(): Promise<string>
  static async importContacts(data: string): Promise<Contact[]>
}
```

**Tasks:**
- [ ] Create ContactStorage class
- [ ] Implement encrypted storage with SecureStore
- [ ] Add address validation (Warthog format)
- [ ] Add duplicate prevention logic
- [ ] Add error handling for storage operations
- [ ] Create backup/restore functionality

---

### 1.3 Address Validation Utility
**File**: `utils/addressValidation.ts`

```typescript
// New file: utils/addressValidation.ts
import { ethers } from 'ethers';

export const validateWarthogAddress = (address: string): {
  isValid: boolean;
  error?: string;
} => {
  // Warthog address validation logic
  // Check length, format, checksum
}

export const normalizeAddress = (address: string): string => {
  // Standardize address format
}
```

**Tasks:**
- [ ] Create address validation functions
- [ ] Test with valid/invalid Warthog addresses
- [ ] Add error messages for different validation failures

---

### 1.4 Custom Hook for Address Book State
**File**: `hooks/useAddressBook.ts`

```typescript
// New file: hooks/useAddressBook.ts
import { useState, useEffect, useCallback } from 'react';
import { Contact, ContactFormData } from '../types';
import { ContactStorage } from '../utils/contactStorage';

export const useAddressBook = () => {
  const [state, setState] = useState<AddressBookState>({
    contacts: [],
    isLoading: false,
    error: null,
    searchQuery: '',
    sortBy: 'name'
  });

  // CRUD operations
  const loadContacts = useCallback(async () => { ... });
  const addContact = useCallback(async (data: ContactFormData) => { ... });
  const updateContact = useCallback(async (id: string, updates: Partial<Contact>) => { ... });
  const deleteContact = useCallback(async (id: string) => { ... });
  
  // Search and filter
  const setSearchQuery = useCallback((query: string) => { ... });
  const setSortBy = useCallback((sortBy: 'name' | 'recent' | 'frequency') => { ... });
  const getFilteredContacts = useCallback(() => { ... });

  return {
    ...state,
    loadContacts,
    addContact,
    updateContact,
    deleteContact,
    setSearchQuery,
    setSortBy,
    filteredContacts: getFilteredContacts(),
  };
};
```

**Tasks:**
- [ ] Create useAddressBook hook
- [ ] Implement all CRUD operations
- [ ] Add search and filter logic
- [ ] Add loading and error states
- [ ] Add optimistic updates for better UX

---

## 🎨 Phase 2: Core Components (Day 3-4)

### 2.1 Contact Item Component
**File**: `components/AddressBook/ContactItem.tsx`

```typescript
// New file: components/AddressBook/ContactItem.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Contact } from '../../types';

interface ContactItemProps {
  contact: Contact;
  onSelect?: (contact: Contact) => void;
  onEdit?: (contact: Contact) => void;
  onDelete?: (contact: Contact) => void;
  showActions?: boolean;
}

export const ContactItem: React.FC<ContactItemProps> = ({
  contact,
  onSelect,
  onEdit,
  onDelete,
  showActions = false
}) => {
  // Avatar circle with initials
  // Contact name and address display
  // Action buttons (edit/delete) when needed
  // Touch handling for selection
};
```

**Tasks:**
- [ ] Create ContactItem component
- [ ] Add avatar generation (colored circle + initials)
- [ ] Add address truncation with copy functionality
- [ ] Add swipe actions for edit/delete
- [ ] Follow existing Card component styling

---

### 2.2 Contact List Component
**File**: `components/AddressBook/ContactList.tsx`

```typescript
// New file: components/AddressBook/ContactList.tsx
import React from 'react';
import { FlatList, View, Text } from 'react-native';
import { Contact } from '../../types';
import { ContactItem } from './ContactItem';

interface ContactListProps {
  contacts: Contact[];
  onSelectContact?: (contact: Contact) => void;
  onEditContact?: (contact: Contact) => void;
  onDeleteContact?: (contact: Contact) => void;
  showActions?: boolean;
  emptyMessage?: string;
}

export const ContactList: React.FC<ContactListProps> = ({
  contacts,
  onSelectContact,
  onEditContact,
  onDeleteContact,
  showActions = false,
  emptyMessage = "No contacts yet"
}) => {
  // FlatList with ContactItem components
  // Empty state design
  // Section headers (favorites, recent, all)
  // Pull-to-refresh functionality
};
```

**Tasks:**
- [ ] Create ContactList component
- [ ] Implement FlatList with proper performance optimization
- [ ] Add empty state design
- [ ] Add section headers for categories
- [ ] Add pull-to-refresh

---

### 2.3 Add/Edit Contact Form
**File**: `components/AddressBook/ContactForm.tsx`

```typescript
// New file: components/AddressBook/ContactForm.tsx
import React, { useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { Input } from '../Input';
import { Button } from '../Button';
import { Contact, ContactFormData } from '../../types';

interface ContactFormProps {
  contact?: Contact;        // For editing existing contact
  onSave: (data: ContactFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export const ContactForm: React.FC<ContactFormProps> = ({
  contact,
  onSave,
  onCancel,
  isLoading = false
}) => {
  // Form state management
  // Real-time validation
  // Error display
  // Save/cancel actions
};
```

**Tasks:**
- [ ] Create ContactForm component
- [ ] Add form validation with real-time feedback
- [ ] Integrate existing Input and Button components
- [ ] Add address validation with clear error messages
- [ ] Handle both add and edit modes

---

### 2.4 Address Book Modal
**File**: `components/AddressBook/AddressBookModal.tsx`

```typescript
// New file: components/AddressBook/AddressBookModal.tsx
import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { useAddressBook } from '../../hooks/useAddressBook';
import { ContactList } from './ContactList';
import { ContactForm } from './ContactForm';
import { Input } from '../Input';

interface AddressBookModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectContact?: (contact: Contact) => void;
  showAddOption?: boolean;
}

export const AddressBookModal: React.FC<AddressBookModalProps> = ({
  visible,
  onClose,
  onSelectContact,
  showAddOption = true
}) => {
  // Modal state management
  // Search functionality
  // Switch between list/form views
  // Contact selection handling
};
```

**Tasks:**
- [ ] Create AddressBookModal component
- [ ] Add search bar at top
- [ ] Implement view switching (list ↔ form)
- [ ] Add proper modal styling and animations
- [ ] Follow existing WalletModal patterns

---

## 🔗 Phase 3: Integration (Day 5-6)

### 3.1 Enhance SendTransaction Component
**File**: `components/SendTransaction.tsx` (modify existing)

**Modifications needed:**
```typescript
// Add to existing SendTransaction.tsx
import { AddressBookModal } from './AddressBook/AddressBookModal';

// Add new state
const [showAddressBook, setShowAddressBook] = useState(false);
const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

// Add address book button to recipient input section
// Handle contact selection
// Update recipient address when contact is selected
```

**Tasks:**
- [ ] Add "Select Contact" button next to recipient input
- [ ] Integrate AddressBookModal
- [ ] Handle contact selection and auto-fill
- [ ] Add "Save as Contact" option for manually entered addresses
- [ ] Maintain existing manual input functionality

---

### 3.2 Enhance Transaction History Integration
**File**: `TransactionHistory.tsx` (modify existing)

**Modifications needed:**
```typescript
// Add contact name display instead of raw addresses
// Add "Add to Contacts" action for unknown addresses
// Show contact avatars in transaction list
```

**Tasks:**
- [ ] Replace raw addresses with contact names where available
- [ ] Add "Add to Contacts" quick action
- [ ] Show contact avatars in transaction history
- [ ] Handle address resolution efficiently

---

## 🎯 Phase 4: User Experience Enhancements (Day 7-8)

### 4.1 Search and Filter
**Features to implement:**
- [ ] Real-time search by name or address
- [ ] Filter by favorites
- [ ] Sort by: Name, Recent usage, Frequency
- [ ] Recent contacts section (last 5 used)

### 4.2 Advanced Features
**Features to implement:**
- [ ] Contact import/export
- [ ] Bulk operations (select multiple, delete multiple)
- [ ] Contact usage analytics
- [ ] QR code scanning for contact addresses
- [ ] Contact sharing

### 4.3 Polish and Animations
**UX improvements:**
- [ ] Loading skeletons for contact list
- [ ] Smooth transitions between views
- [ ] Haptic feedback for actions
- [ ] Swipe gestures for common actions
- [ ] Pull-to-refresh animations

---

## ✅ Phase 5: Testing & Validation (Day 9-10)

### 5.1 Unit Tests
**File**: `__tests__/AddressBook/`

```typescript
// ContactStorage.test.ts - Test all CRUD operations
// useAddressBook.test.ts - Test hook functionality
// addressValidation.test.ts - Test validation logic
```

**Tasks:**
- [ ] Test contact CRUD operations
- [ ] Test address validation edge cases
- [ ] Test search and filter functionality
- [ ] Test error handling scenarios

### 5.2 Component Tests
**File**: `__tests__/components/AddressBook/`

```typescript
// ContactItem.test.tsx - Test contact item rendering and actions
// ContactList.test.tsx - Test list rendering and interactions
// ContactForm.test.tsx - Test form validation and submission
// AddressBookModal.test.tsx - Test modal behavior
```

**Tasks:**
- [ ] Test component rendering
- [ ] Test user interactions
- [ ] Test form validation
- [ ] Test modal behavior

### 5.3 Integration Tests
**File**: `__tests__/integration/`

```typescript
// SendTransaction.integration.test.tsx - Test address book integration
// TransactionHistory.integration.test.tsx - Test contact name resolution
```

**Tasks:**
- [ ] Test complete user flows
- [ ] Test integration with existing components
- [ ] Test data persistence
- [ ] Test error recovery

---

## 🔧 Technical Implementation Details

### State Management Pattern
```typescript
// Follow existing hooks pattern from useWallet.ts
// Use React.useState for local component state
// Use useCallback to prevent unnecessary re-renders
// Implement optimistic updates for better UX
```

### Security Implementation
```typescript
// Use expo-secure-store for all contact data
// Encrypt contact data before storage
// Validate all addresses before saving
// Never store sensitive data in component state
```

### Performance Optimizations
```typescript
// Use React.memo for contact items
// Implement virtualization for large contact lists
// Cache contact lookups for transaction history
// Debounce search input to prevent excessive filtering
```

---

## 📋 Quality Checklist

### Before Each Phase
- [ ] All TypeScript errors resolved
- [ ] No breaking changes to existing functionality
- [ ] Manual testing of new features completed
- [ ] Performance testing (no lag in UI)
- [ ] Code review checklist passed

### Final Delivery Checklist
- [ ] All tests passing (>80% coverage)
- [ ] No TypeScript warnings or errors
- [ ] All user stories completed
- [ ] Performance benchmarks met
- [ ] Security review completed
- [ ] Documentation updated
- [ ] Manual testing checklist completed

---

## 🚨 Risk Mitigation

### Technical Risks
- **SecureStore failures**: Implement fallback to AsyncStorage with encryption warning
- **Performance with many contacts**: Implement virtualization and pagination
- **Address validation edge cases**: Comprehensive test suite for all Warthog address formats

### User Experience Risks
- **Complex UI**: Start with minimal viable interface, add features incrementally
- **Data loss**: Implement automatic backups and export functionality
- **Migration issues**: Version contact storage format for future updates

---

## 📞 Implementation Support

### Key Files to Reference
- `components/Button.tsx` - Button styling patterns
- `components/Input.tsx` - Input field patterns
- `hooks/useWallet.ts` - SecureStore usage patterns
- `theme.ts` - Color and spacing constants

### Testing Commands
```bash
# Run development server
npx expo start -c

# Run tests
npm test

# Type checking
npx tsc --noEmit

# Lint code
npx eslint .
```

---

**Ready to start?** Begin with Phase 1, and ensure each phase is fully functional before moving to the next. The modular approach allows for iterative development and testing.
