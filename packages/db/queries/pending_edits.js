const { supabase } = require('../client');

async function setPendingEdit(chatId, messageId) {
    const { error } = await supabase
        .from('pending_edits')
        .upsert({ chat_id: chatId, message_id: messageId }, { onConflict: 'chat_id' });
    return error ? null : true;
}

async function getPendingEdit(chatId) {
    const { data, error } = await supabase
        .from('pending_edits')
        .select('message_id')
        .eq('chat_id', chatId)
        .single();
    return error ? null : data?.message_id;
}

async function clearPendingEdit(chatId) {
    const { error } = await supabase
        .from('pending_edits')
        .delete()
        .eq('chat_id', chatId);
    return error ? null : true;
}

module.exports = { setPendingEdit, getPendingEdit, clearPendingEdit };
