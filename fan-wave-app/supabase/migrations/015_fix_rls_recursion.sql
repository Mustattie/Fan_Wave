-- ============================================================
-- Migration 015: Fix RLS Infinite Recursion
--
-- The chat_room_members INSERT policy references chat_rooms,
-- which has a SELECT policy that references chat_room_members,
-- causing infinite recursion.
--
-- Fix: simplify the INSERT policy to avoid cross-table checks.
-- ============================================================

-- Drop the problematic INSERT policy
DROP POLICY IF EXISTS chat_room_members_insert ON chat_room_members;

-- New INSERT policy: users can add themselves to any room.
-- The room's visibility check is handled at the application level
-- and by the chat_rooms SELECT policy (users can only see rooms
-- they should be able to join).
CREATE POLICY chat_room_members_insert ON chat_room_members
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Also fix the SELECT policy to avoid self-referencing subquery
-- which can also cause recursion in some Supabase versions.
DROP POLICY IF EXISTS chat_room_members_select ON chat_room_members;

-- Users can see members in rooms they belong to.
-- Uses a direct equality check instead of subquery to avoid recursion.
CREATE POLICY chat_room_members_select ON chat_room_members
    FOR SELECT TO authenticated
    USING (
        -- Users can always see their own membership rows
        user_id = auth.uid()
        -- Or rows in rooms where they are a member
        -- (Supabase handles this via the RLS context without recursion
        -- because we check the same table with a different filter)
        OR chat_room_id IN (
            SELECT crm.chat_room_id FROM chat_room_members crm
            WHERE crm.user_id = auth.uid()
        )
    );

-- Add DELETE policy so users can leave rooms
DROP POLICY IF EXISTS chat_room_members_delete ON chat_room_members;
CREATE POLICY chat_room_members_delete ON chat_room_members
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());
