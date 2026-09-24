import React from 'react';
export function AccountingTraceLink({entityType,id,can}:{entityType:string;id:string;can:(p:string)=>boolean}){
 if(!can('accounting_event.view'))return null;
 return <p><a href={'/app/accounting-events?entity_type='+encodeURIComponent(entityType)+'&entity_id='+encodeURIComponent(id)}>Ver eventos, preview y asientos de esta operación</a></p>;
}
